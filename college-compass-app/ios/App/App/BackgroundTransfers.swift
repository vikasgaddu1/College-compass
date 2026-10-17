import Foundation
import UIKit
import UserNotifications

/// Research requests that keep running after the student leaves the app.
///
/// A suspended app's WebView stops, and so do ordinary URLSession tasks. Requests sent here go
/// through a *background* URLSession (upload tasks from a temp file), which iOS keeps running while
/// the app is suspended; iOS wakes the app when they finish. When the last request of a research
/// run finishes while the app is not in the foreground, an armed local notification is posted
/// ("Your college list is ready"). JavaScript picks up the responses as soon as it runs again.
///
/// Limitation: if iOS terminates the app process (not just suspends it), the in-flight responses
/// have no JavaScript caller left; nothing is posted and research restarts when the app opens.
final class BackgroundTransfers: NSObject, URLSessionDataDelegate {
    static let shared = BackgroundTransfers()
    static let sessionIdentifier = "com.gaddu.collegecompass.research"

    typealias Completion = (Result<[String: Any], NativeHttpPlugin.Failure>) -> Void

    private struct Pending {
        let id: String
        let completion: Completion
        var data = Data()
        let bodyFile: URL?
    }

    private let lock = NSLock()
    private var pending: [Int: Pending] = [:]          // by task identifier
    private var idToTask: [String: Int] = [:]
    private var armed: (title: String, body: String)?
    /// Set by AppDelegate when iOS wakes the app for this session's events.
    var systemCompletionHandler: (() -> Void)?

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

    // MARK: - Requests

    func perform(_ req: URLRequest, id: String, completion: @escaping Completion) {
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
        pending[task.taskIdentifier] = Pending(id: id, completion: completion, bodyFile: bodyFile)
        idToTask[id] = task.taskIdentifier
        lock.unlock()
        task.resume()
    }

    /// Returns true when a request with this id was found (and cancelled).
    @discardableResult
    func cancel(id: String) -> Bool {
        lock.lock()
        let tid = idToTask[id]
        lock.unlock()
        guard let tid else { return false }
        session.getAllTasks { tasks in tasks.first { $0.taskIdentifier == tid }?.cancel() }
        return true
    }

    // MARK: - Notification when the last request finishes in the background

    func arm(title: String, body: String) {
        lock.lock(); armed = (title, body); lock.unlock()
    }

    func disarm() {
        lock.lock(); armed = nil; lock.unlock()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["cc-research-ready"])
    }

    var inFlight: Int {
        lock.lock(); defer { lock.unlock() }
        return pending.count
    }

    private func notifyIfIdle() {
        lock.lock()
        let idle = pending.isEmpty
        let note = idle ? armed : nil
        if note != nil { armed = nil }
        lock.unlock()
        guard let note else { return }
        DispatchQueue.main.async {
            // In the foreground the student is watching the screen already.
            guard UIApplication.shared.applicationState != .active else { return }
            let content = UNMutableNotificationContent()
            content.title = note.title
            content.body = note.body
            content.sound = .default
            let request = UNNotificationRequest(identifier: "cc-research-ready", content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)
        }
    }

    // MARK: - URLSession delegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        pending[dataTask.taskIdentifier]?.data.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let data = (try? Data(contentsOf: location)) ?? Data()
        lock.lock()
        pending[downloadTask.taskIdentifier]?.data.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let p = pending.removeValue(forKey: task.taskIdentifier)
        if let p { idToTask.removeValue(forKey: p.id) }
        lock.unlock()
        guard let p else { return } // orphaned after a relaunch: no JavaScript caller left
        if let file = p.bodyFile { try? FileManager.default.removeItem(at: file) }

        if let error = error as NSError? {
            if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
                p.completion(.failure(.init(code: "ABORTED", message: "Aborted")))
            } else {
                p.completion(.failure(.init(code: "NETWORK", message: error.localizedDescription)))
            }
        } else if let http = task.response as? HTTPURLResponse {
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                headers[String(describing: key)] = String(describing: value)
            }
            let text = String(decoding: p.data, as: UTF8.self)
            p.completion(.success(["status": http.statusCode, "headers": headers, "data": text]))
        } else {
            p.completion(.failure(.init(code: "NETWORK", message: "No HTTP response")))
        }
        notifyIfIdle()
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            let handler = self.systemCompletionHandler
            self.systemCompletionHandler = nil
            handler?()
        }
    }
}
