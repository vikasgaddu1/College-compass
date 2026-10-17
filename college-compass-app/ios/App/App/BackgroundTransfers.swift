import Foundation
import UIKit
import UserNotifications

/// Research requests that keep running after the student leaves the app.
///
/// A suspended app's WebView stops, and so do ordinary URLSession tasks. Requests sent here go
/// through a *background* URLSession (upload tasks from a temp file), which iOS keeps running while
/// the app is suspended, and iOS wakes (or relaunches) the app when they finish.
///
/// Notifications are tied to the research *run*, not to whichever tasks happen to be in flight:
/// JavaScript registers a run with the number of agent requests it will make (`beginRun`), and each
/// request carries the tag `research:<runId>:…`. When the run has no requests left in flight while
/// the app is in the background:
/// - all expected requests finished OK → "Your college list is ready";
/// - otherwise (JavaScript still has requests to start or retry, and it is suspended) →
///   "Open College Compass to finish your research".
///
/// iOS may terminate the suspended process and relaunch it in the background to deliver results.
/// Task metadata, the run and the armed notification are persisted (UserDefaults), so a relaunched
/// process still counts and notifies, and responses without a JavaScript caller are saved to disk
/// ("orphans") for JavaScript to pick up on the next run (`takeOrphans`).
final class BackgroundTransfers: NSObject, URLSessionDataDelegate {
    static let shared = BackgroundTransfers()
    static let sessionIdentifier = "com.gaddu.collegecompass.research"
    private static let stateKey = "cc.backgroundTransfers.state.v1"

    typealias Completion = (Result<[String: Any], NativeHttpPlugin.Failure>) -> Void

    // MARK: Persisted state

    private struct TaskMeta: Codable {
        let id: String
        let tag: String?
        let bodyFile: String?
    }
    private struct RunState: Codable {
        let runId: String
        let expected: Int
        var finishedOK: Int
        var notified: Bool
    }
    private struct Armed: Codable {
        let title: String
        let body: String
    }
    private struct State: Codable {
        var tasks: [Int: TaskMeta] = [:]
        var run: RunState?
        var armed: Armed?
    }

    private let lock = NSLock()
    private var state: State
    /// In-memory only: JavaScript callers and response bytes for tasks of this process.
    private var completions: [Int: Completion] = [:]
    private var buffers: [Int: Data] = [:]
    /// Set by AppDelegate when iOS wakes the app for this session's events.
    var systemCompletionHandler: (() -> Void)?

    private override init() {
        if let data = UserDefaults.standard.data(forKey: Self.stateKey),
           let saved = try? JSONDecoder().decode(State.self, from: data) {
            state = saved
        } else {
            state = State()
        }
        super.init()
    }

    /// Call with `lock` held.
    private func persist() {
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: Self.stateKey)
        }
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 3600
        config.httpShouldSetCookies = false
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Recreates the session after a background relaunch so iOS can deliver its events.
    func reconnect() {
        _ = session
    }

    // MARK: - Requests

    func perform(_ req: URLRequest, id: String, tag: String?, completion: @escaping Completion) {
        var bodyFile: URL?
        let task: URLSessionTask
        if let body = req.httpBody {
            // Background sessions only send bodies from files.
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("cc-bg-\(UUID().uuidString).json")
            do {
                try body.write(to: file, options: .atomic)
            } catch {
                completion(.failure(.init(code: "NETWORK", message: "Couldn't prepare the request.")))
                return
            }
            var r = req
            r.httpBody = nil
            task = session.uploadTask(with: r, fromFile: file)
            bodyFile = file
        } else {
            task = session.downloadTask(with: req)
        }
        lock.lock()
        state.tasks[task.taskIdentifier] = TaskMeta(id: id, tag: tag, bodyFile: bodyFile?.path)
        completions[task.taskIdentifier] = completion
        persist()
        lock.unlock()
        task.resume()
    }

    /// Returns true when a request with this id was found (and cancelled).
    @discardableResult
    func cancel(id: String) -> Bool {
        lock.lock()
        let tid = state.tasks.first { $0.value.id == id }?.key
        lock.unlock()
        guard let tid else { return false }
        session.getAllTasks { tasks in tasks.first { $0.taskIdentifier == tid }?.cancel() }
        return true
    }

    // MARK: - Runs and notifications

    func beginRun(runId: String, expected: Int) {
        lock.lock()
        state.run = RunState(runId: runId, expected: max(0, expected), finishedOK: 0, notified: false)
        persist()
        lock.unlock()
    }

    func endRun(runId: String) {
        lock.lock()
        if state.run?.runId == runId {
            state.run = nil
            state.armed = nil
            persist()
        }
        lock.unlock()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["cc-research-ready"])
    }

    func arm(title: String, body: String) {
        lock.lock()
        state.armed = Armed(title: title, body: body)
        persist()
        lock.unlock()
    }

    func disarm() {
        lock.lock()
        state.armed = nil
        persist()
        lock.unlock()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["cc-research-ready"])
    }

    var inFlight: Int {
        lock.lock(); defer { lock.unlock() }
        return state.tasks.count
    }

    private func runTagPrefix(_ run: RunState) -> String { "research:\(run.runId):" }

    /// Posts at most one notification per run, only while the app is not in the foreground.
    private func evaluateRun() {
        DispatchQueue.main.async {
            // In the foreground the student is watching the screen already.
            guard UIApplication.shared.applicationState != .active else { return }
            self.lock.lock()
            guard var run = self.state.run, !run.notified, let armed = self.state.armed else {
                self.lock.unlock()
                return
            }
            let prefix = self.runTagPrefix(run)
            let stillRunning = self.state.tasks.values.contains { $0.tag?.hasPrefix(prefix) == true }
            if stillRunning {
                self.lock.unlock()
                return
            }
            let ready = run.finishedOK >= run.expected
            run.notified = true
            self.state.run = run
            self.persist()
            self.lock.unlock()

            let content = UNMutableNotificationContent()
            if ready {
                content.title = armed.title
                content.body = armed.body
            } else {
                content.title = "Open College Compass to finish"
                content.body = "Most of your research is back. Open the app to finish the last few colleges."
            }
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "cc-research-ready", content: content, trigger: nil))
        }
    }

    // MARK: - Orphans (responses with no JavaScript caller after a relaunch)

    private static var orphanDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("cc-research-orphans", isDirectory: true)
    }

    private func saveOrphan(tag: String, data: Data) {
        let dir = Self.orphanDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let payload: [String: String] = ["tag": tag, "data": String(decoding: data, as: UTF8.self)]
        if let json = try? JSONSerialization.data(withJSONObject: payload) {
            try? json.write(to: dir.appendingPathComponent("\(UUID().uuidString).json"), options: .atomic)
        }
    }

    /// Returns and deletes saved orphan responses.
    func takeOrphans() -> [[String: String]] {
        let dir = Self.orphanDir
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return [] }
        var out: [[String: String]] = []
        for f in files where f.pathExtension == "json" {
            if let data = try? Data(contentsOf: f),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
                out.append(obj)
            }
            try? FileManager.default.removeItem(at: f)
        }
        return out
    }

    // MARK: - URLSession delegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        buffers[dataTask.taskIdentifier, default: Data()].append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let data = (try? Data(contentsOf: location)) ?? Data()
        lock.lock()
        buffers[downloadTask.taskIdentifier, default: Data()].append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let http = task.response as? HTTPURLResponse
        let ok = error == nil && http?.statusCode == 200

        lock.lock()
        let meta = state.tasks.removeValue(forKey: task.taskIdentifier)
        let completion = completions.removeValue(forKey: task.taskIdentifier)
        let data = buffers.removeValue(forKey: task.taskIdentifier) ?? Data()
        if ok, let tag = meta?.tag, var run = state.run, tag.hasPrefix(runTagPrefix(run)) {
            run.finishedOK += 1
            state.run = run
        }
        persist()
        lock.unlock()

        if let path = meta?.bodyFile { try? FileManager.default.removeItem(atPath: path) }

        if let completion {
            if let error = error as NSError? {
                if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
                    completion(.failure(.init(code: "ABORTED", message: "Aborted")))
                } else {
                    completion(.failure(.init(code: "NETWORK", message: error.localizedDescription)))
                }
            } else if let http {
                var headers: [String: String] = [:]
                for (key, value) in http.allHeaderFields {
                    headers[String(describing: key)] = String(describing: value)
                }
                completion(.success(["status": http.statusCode, "headers": headers, "data": String(decoding: data, as: UTF8.self)]))
            } else {
                completion(.failure(.init(code: "NETWORK", message: "No HTTP response")))
            }
        } else if ok, let tag = meta?.tag, tag.hasPrefix("research:") {
            // The process was relaunched: no JavaScript caller. Keep the answer for the next run.
            saveOrphan(tag: tag, data: data)
        }
        evaluateRun()
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            let handler = self.systemCompletionHandler
            self.systemCompletionHandler = nil
            handler?()
        }
    }
}
