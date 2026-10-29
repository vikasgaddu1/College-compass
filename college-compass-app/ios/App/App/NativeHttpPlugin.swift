import Foundation
import Capacitor
import UserNotifications

/// Cancellable HTTPS requests for the app's OpenAI calls.
///
/// api.openai.com does not send CORS headers for authenticated requests, so the WebView's `fetch`
/// cannot reach it. JavaScript calls this plugin instead (see `src/platform/index.ts` →
/// `httpFetch`). Each request carries a caller-chosen `id`; `cancel({ id })` cancels the underlying
/// URLSession task, which closes the connection so OpenAI stops generating (and stops counting
/// against the user's ChatGPT plan) when the student stops research or chat.
///
/// JS: `request({ id, url, method?, headers?, body?, timeoutMs?, background? }) -> { status, headers, data, url? }`
/// (`url` is the final URL after redirects; absent on the background path)
/// (rejects with code `ABORTED` after `cancel`, `NETWORK` on transport errors), `cancel({ id })`.
/// The response body is returned whole as UTF-8 text. `background: true` sends the request through
/// `BackgroundTransfers` so it keeps running after the student leaves the app.
///
/// Notifications: `requestNotificationPermission() -> { granted }`, `notifyWhenDone({ title, body })`
/// arms a local notification for when the last background request finishes while the app is not in
/// the foreground; `cancelNotify()` disarms it.
@objc(NativeHttpPlugin)
public class NativeHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeHttpPlugin"
    public let jsName = "NativeHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyWhenDone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelNotify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginRun", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endRun", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeOrphans", returnType: CAPPluginReturnPromise)
    ]

    private let lock = NSLock()
    private var tasks: [String: URLSessionDataTask] = [:]
    /// Ids cancelled before their request started (cancel raced request).
    private var cancelledEarly: Set<String> = []

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 600
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }()

    // MARK: - Plugin methods

    @objc func request(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("Missing request id", "INVALID")
            return
        }
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              url.scheme?.lowercased() == "https" else {
            call.reject("Only https URLs are allowed", "INVALID")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = (call.getString("method") ?? "GET").uppercased()
        if let headers = call.getObject("headers") {
            for (name, value) in headers {
                if let s = value as? String { req.setValue(s, forHTTPHeaderField: name) }
            }
        }
        if let body = call.getString("body") { req.httpBody = Data(body.utf8) }
        if let ms = call.getDouble("timeoutMs"), ms > 0 { req.timeoutInterval = ms / 1000 }

        let handle: (Result<[String: Any], Failure>) -> Void = { result in
            switch result {
            case .success(let payload): call.resolve(payload)
            case .failure(let failure): call.reject(failure.message, failure.code)
            }
        }
        send(req, id: id, background: call.getBool("background") == true, tag: call.getString("tag")) { result, _ in handle(result) }
    }

    /// Set once the background session has failed to start a request (seen in the iOS Simulator:
    /// "unknown error"); later requests then go straight to the normal session.
    private static var backgroundUnavailable = false
    private static let flagLock = NSLock()

    /// Background session first, so research keeps running after the student leaves the app. If it
    /// fails quickly with a transport error, retry once on the normal session: at worst research
    /// behaves as it did before (it just pauses while the app is in the background).
    /// `via` reports which path produced the result ("background" / "foreground").
    func send(_ req: URLRequest, id: String, background: Bool, tag: String? = nil,
              completion: @escaping (Result<[String: Any], Failure>, String) -> Void) {
        Self.flagLock.lock()
        let useBackground = background && !Self.backgroundUnavailable
        Self.flagLock.unlock()
        guard useBackground else {
            perform(req, id: id) { completion($0, "foreground") }
            return
        }
        let started = Date()
        BackgroundTransfers.shared.perform(req, id: id, tag: tag) { [weak self] result in
            if case .failure(let f) = result, f.code == "NETWORK", Date().timeIntervalSince(started) < 20, let self {
                Self.flagLock.lock(); Self.backgroundUnavailable = true; Self.flagLock.unlock()
                NSLog("CC_NATIVEHTTP background session unavailable (%@); using the normal session", f.message)
                self.perform(req, id: id) { completion($0, "foreground") }
                return
            }
            completion(result, "background")
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        if !BackgroundTransfers.shared.cancel(id: id) { cancel(id: id) }
        call.resolve()
    }

    @objc func requestNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    @objc func notifyWhenDone(_ call: CAPPluginCall) {
        BackgroundTransfers.shared.arm(
            title: call.getString("title") ?? "Your college list is ready",
            body: call.getString("body") ?? "Open Tierwise to see your colleges and odds."
        )
        call.resolve()
    }

    @objc func cancelNotify(_ call: CAPPluginCall) {
        BackgroundTransfers.shared.disarm()
        call.resolve()
    }

    /// A research run: `expected` agent requests tagged `research:<runId>:…` (see BackgroundTransfers).
    @objc func beginRun(_ call: CAPPluginCall) {
        guard let runId = call.getString("runId"), !runId.isEmpty else {
            call.reject("Missing runId", "INVALID")
            return
        }
        BackgroundTransfers.shared.beginRun(runId: runId, expected: call.getInt("expected") ?? 0)
        call.resolve()
    }

    @objc func endRun(_ call: CAPPluginCall) {
        BackgroundTransfers.shared.endRun(runId: call.getString("runId") ?? "")
        call.resolve()
    }

    /// Research answers iOS delivered after relaunching the app in the background (no JS caller then).
    @objc func takeOrphans(_ call: CAPPluginCall) {
        call.resolve(["orphans": BackgroundTransfers.shared.takeOrphans()])
    }

    // MARK: - Core (also used by the CI self-test)

    struct Failure: Error {
        let code: String
        let message: String
    }

    func perform(_ req: URLRequest, id: String, completion: @escaping (Result<[String: Any], Failure>) -> Void) {
        let task = session.dataTask(with: req) { [weak self] data, response, error in
            self?.forget(id)
            if let error = error as NSError? {
                if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
                    completion(.failure(Failure(code: "ABORTED", message: "Aborted")))
                } else {
                    completion(.failure(Failure(code: "NETWORK", message: error.localizedDescription)))
                }
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(Failure(code: "NETWORK", message: "No HTTP response")))
                return
            }
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                headers[String(describing: key)] = String(describing: value)
            }
            let text = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
            // Final URL after redirects, so JS can tell when a page redirected elsewhere (deadline proof check).
            let finalUrl = http.url?.absoluteString ?? ""
            completion(.success(["status": http.statusCode, "headers": headers, "data": text, "url": finalUrl]))
        }

        lock.lock()
        let alreadyCancelled = cancelledEarly.remove(id) != nil
        if !alreadyCancelled { tasks[id] = task }
        lock.unlock()

        if alreadyCancelled {
            completion(.failure(Failure(code: "ABORTED", message: "Aborted")))
            return
        }
        task.resume()
    }

    func cancel(id: String) {
        guard !id.isEmpty else { return }
        lock.lock()
        let task = tasks.removeValue(forKey: id)
        if task == nil {
            cancelledEarly.insert(id)
            // Keep the early-cancel set small; ids are unique per request.
            if cancelledEarly.count > 256 { cancelledEarly.removeAll() }
        }
        lock.unlock()
        task?.cancel()
    }

    private func forget(_ id: String) {
        lock.lock()
        tasks.removeValue(forKey: id)
        lock.unlock()
    }

    // MARK: - CI self-test

    /// Launch argument `-ccNativeHttpSelfTest`: proves, inside a real iOS runtime, that the app can
    /// reach api.openai.com natively (unauthenticated `GET /v1/models` → 401) and that cancelling a
    /// request aborts it. Results go to `Documents/cc_nativehttp_selftest.txt` for the CI job.
    ///
    /// `extra` lets the caller add further checks (e.g. the PDF render check in MainViewController):
    /// it receives a `record` function for result lines and must call `done` once, after which the
    /// file is written together with the HTTP results.
    func runSelfTest(extra: ((_ record: @escaping (String) -> Void, _ done: @escaping () -> Void) -> Void)? = nil) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let out = docs.appendingPathComponent("cc_nativehttp_selftest.txt")
        var lines: [String] = []
        let lineLock = NSLock()
        let group = DispatchGroup()
        func record(_ s: String) {
            lineLock.lock(); lines.append(s); lineLock.unlock()
            NSLog("CC_NATIVEHTTP %@", s)
        }

        if let extra = extra {
            group.enter()
            extra(record, { group.leave() })
        }

        let url = URL(string: "https://api.openai.com/v1/models")!
        group.enter()
        perform(URLRequest(url: url), id: "selftest-status") { result in
            switch result {
            case .success(let p): record("status=\(p["status"] ?? "?")")
            case .failure(let f): record("status-error=\(f.code) \(f.message)")
            }
            group.leave()
        }

        group.enter()
        perform(URLRequest(url: url), id: "selftest-cancel") { result in
            switch result {
            case .success: record("cancel=not-cancelled")
            case .failure(let f): record("cancel=\(f.code)")
            }
            group.leave()
        }
        cancel(id: "selftest-cancel")

        // AI POST path (background session, falling back to the normal one) → 401 without a token.
        var post = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        post.httpMethod = "POST"
        post.setValue("application/json", forHTTPHeaderField: "Content-Type")
        post.httpBody = Data("{}".utf8)
        group.enter()
        send(post, id: "selftest-bg", background: true) { result, via in
            switch result {
            case .success(let p): record("bgstatus=\(p["status"] ?? "?") via=\(via)")
            case .failure(let f): record("bgstatus-error=\(f.code) \(f.message) via=\(via)")
            }
            group.leave()
        }

        group.notify(queue: .global()) {
            lineLock.lock()
            let text = lines.sorted().joined(separator: "\n") + "\n"
            lineLock.unlock()
            try? text.write(to: out, atomically: true, encoding: .utf8)
        }
    }
}
