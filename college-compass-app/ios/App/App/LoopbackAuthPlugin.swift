import Foundation
import Network
import Capacitor

/// Loopback HTTP listener for OpenAI's self-serve "Sign in with ChatGPT" path (open-source, locally
/// run apps). The authorize redirect goes to `http://127.0.0.1:<port>/auth/callback`; this plugin
/// accepts that single request inside the app, answers with a small "you can return to the app"
/// page and hands the full callback URL to JavaScript as a `callback` event.
///
/// - Binds to 127.0.0.1 only (never `localhost`, never other interfaces).
/// - Tries the preferred port (1455) first, then an OS-assigned port.
/// - All state lives on one serial `queue`; listener and connection callbacks run on it too.
///
/// JS: `start({ preferredPort? }) -> { port }`, `stop()`, event `callback` `{ url }`.
@objc(LoopbackAuthPlugin)
public class LoopbackAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LoopbackAuthPlugin"
    public let jsName = "LoopbackAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private static let host = "127.0.0.1"
    private static let callbackPath = "/auth/callback"
    private static let defaultPort: UInt16 = 1455
    /// Largest request head we accept (request line + headers).
    private static let maxRequestBytes = 32 * 1024
    /// A connection that hasn't sent a full request head by then is dropped.
    private static let connectionTimeout: TimeInterval = 15

    private let queue = DispatchQueue(label: "com.gaddu.collegecompass.loopback-auth")

    // Everything below is only touched on `queue`.
    private var listener: NWListener?
    private var port: UInt16 = 0
    /// Bumped on every start/stop so callbacks from an old listener are ignored.
    private var generation = 0
    /// One callback event per listener.
    private var delivered = false
    private var pendingStart: CAPPluginCall?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    /// CI self-test: listen without a JS call and log events (launch argument `-ccLoopbackSelfTest`).
    private var selfTest = false

    /// Starts the listener without a JS caller and logs `CC_LOOPBACK ...` lines. Used only by the
    /// iOS Simulator smoke test in CI to prove the 127.0.0.1 callback works inside a real iOS runtime.
    func startSelfTest() {
        queue.async {
            self.teardown(rejectPendingWith: "Superseded by a new sign-in.")
            self.generation += 1
            self.delivered = false
            self.selfTest = true
            self.listen(ports: [Self.defaultPort, 0], generation: self.generation)
        }
    }

    // MARK: - Plugin methods

    @objc func start(_ call: CAPPluginCall) {
        var preferred = Self.defaultPort
        if let p = call.getInt("preferredPort"), p > 0, p <= 65535 {
            preferred = UInt16(p)
        }
        queue.async {
            self.teardown(rejectPendingWith: "Superseded by a new sign-in.")
            self.generation += 1
            self.delivered = false
            self.pendingStart = call
            var ports: [UInt16] = [preferred]
            if preferred != 0 { ports.append(0) } // 0 = OS-assigned
            self.listen(ports: ports, generation: self.generation)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async {
            self.teardown(rejectPendingWith: "Sign-in listener stopped.")
            self.generation += 1
            call.resolve()
        }
    }

    // MARK: - Listener

    private func listen(ports: [UInt16], generation gen: Int) {
        guard gen == generation, pendingStart != nil || selfTest else { return }
        let call = pendingStart
        guard let requested = ports.first else {
            pendingStart = nil
            call?.reject("Couldn't open a local port for ChatGPT sign-in.")
            if selfTest { NSLog("CC_LOOPBACK failed") }
            return
        }
        let remaining = Array(ports.dropFirst())

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.includePeerToPeer = false
        let nwPort = NWEndpoint.Port(rawValue: requested) ?? .any
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(Self.host), port: nwPort)

        let newListener: NWListener
        do {
            newListener = try NWListener(using: params)
        } catch {
            listen(ports: remaining, generation: gen)
            return
        }

        let attempt = Attempt() // reference box: no captured `var` mutated inside the handler
        newListener.stateUpdateHandler = { [weak self, weak newListener] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                guard !attempt.settled else { return }
                attempt.settled = true
                guard gen == self.generation, self.pendingStart != nil || self.selfTest else {
                    newListener?.cancel()
                    return
                }
                let call = self.pendingStart
                let actual = newListener?.port?.rawValue ?? requested
                guard actual != 0 else {
                    newListener?.cancel()
                    if self.listener === newListener { self.listener = nil }
                    self.listen(ports: remaining, generation: gen)
                    return
                }
                self.port = actual
                self.pendingStart = nil
                call?.resolve(["port": Int(actual)])
                if self.selfTest { NSLog("CC_LOOPBACK ready port=%d", Int(actual)) }
            case .failed, .waiting:
                // Port in use / not available: try the next candidate (only before ready).
                newListener?.cancel()
                if self.listener === newListener { self.listener = nil }
                if !attempt.settled {
                    attempt.settled = true
                    self.listen(ports: remaining, generation: gen)
                }
            case .cancelled:
                if self.listener === newListener { self.listener = nil }
            default:
                break
            }
        }
        newListener.newConnectionHandler = { [weak self] connection in
            guard let self = self, gen == self.generation else {
                connection.cancel()
                return
            }
            self.accept(connection, generation: gen)
        }
        listener = newListener
        newListener.start(queue: queue)
    }

    private func teardown(rejectPendingWith message: String) {
        if let call = pendingStart {
            pendingStart = nil
            call.reject(message)
        }
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel()
        listener = nil
        for connection in connections.values { connection.cancel() }
        connections.removeAll()
    }

    // MARK: - Connections

    private func accept(_ connection: NWConnection, generation gen: Int) {
        let key = ObjectIdentifier(connection)
        connections[key] = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.connections.removeValue(forKey: key)
            default:
                break
            }
        }
        connection.start(queue: queue)
        let timeout = DispatchWorkItem { [weak connection] in connection?.cancel() }
        queue.asyncAfter(deadline: .now() + Self.connectionTimeout, execute: timeout)
        receive(on: connection, buffer: Data(), generation: gen, timeout: timeout)
    }

    private func receive(on connection: NWConnection, buffer: Data, generation gen: Int, timeout: DispatchWorkItem) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, isComplete, error in
            guard let self = self else {
                connection.cancel()
                return
            }
            var buffer = buffer
            if let data = data { buffer.append(data) }

            let headEnd = buffer.range(of: Data("\r\n\r\n".utf8))
            if headEnd == nil && buffer.count > Self.maxRequestBytes {
                timeout.cancel()
                self.respond(on: connection, status: "431 Request Header Fields Too Large", contentType: "text/plain; charset=utf-8", body: "Request too large.")
                return
            }
            if headEnd == nil && error == nil && !isComplete {
                // Partial read: keep reading until the request head is complete.
                self.receive(on: connection, buffer: buffer, generation: gen, timeout: timeout)
                return
            }
            timeout.cancel()
            guard error == nil || headEnd != nil, !buffer.isEmpty else {
                connection.cancel()
                return
            }
            self.handleRequest(buffer, on: connection, generation: gen)
        }
    }

    private func handleRequest(_ data: Data, on connection: NWConnection, generation gen: Int) {
        guard let lineEnd = data.range(of: Data("\r\n".utf8)) ?? data.range(of: Data("\n".utf8)),
              let requestLine = String(data: data.subdata(in: data.startIndex..<lineEnd.lowerBound), encoding: .utf8) else {
            respond(on: connection, status: "400 Bad Request", contentType: "text/plain; charset=utf-8", body: "Bad request.")
            return
        }
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2 else {
            respond(on: connection, status: "400 Bad Request", contentType: "text/plain; charset=utf-8", body: "Bad request.")
            return
        }
        let method = String(parts[0])
        let target = String(parts[1])
        let path: String
        let query: String
        if let q = target.firstIndex(of: "?") {
            path = String(target[..<q])
            query = String(target[target.index(after: q)...])
        } else {
            path = target
            query = ""
        }

        guard method == "GET", path == Self.callbackPath, !query.isEmpty else {
            respond(on: connection, status: "404 Not Found", contentType: "text/plain; charset=utf-8", body: "Not found.")
            return
        }

        let url = "http://\(Self.host):\(port)\(Self.callbackPath)?\(query)"
        let shouldNotify = gen == generation && !delivered
        if shouldNotify { delivered = true } // single callback, even if the page is reloaded
        respond(on: connection, status: "200 OK", contentType: "text/html; charset=utf-8", body: Self.successPage) { [weak self] in
            guard shouldNotify, let self = self else { return }
            if self.selfTest { NSLog("CC_LOOPBACK callback %@", url) }
            self.notifyListeners("callback", data: ["url": url])
        }
    }

    private func respond(on connection: NWConnection, status: String, contentType: String, body: String, then: (() -> Void)? = nil) {
        let bodyData = Data(body.utf8)
        let head = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(contentType)",
            "Content-Length: \(bodyData.count)",
            "Cache-Control: no-store",
            "Referrer-Policy: no-referrer",
            "X-Content-Type-Options: nosniff",
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'",
            "Connection: close",
            "",
            ""
        ].joined(separator: "\r\n")
        var payload = Data(head.utf8)
        payload.append(bodyData)
        connection.send(content: payload, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
            connection.cancel()
            then?()
        })
    }

    /// Per-listener-attempt flag: set once the attempt resolved `start` or moved on to the next port.
    private final class Attempt {
        var settled = false
    }

    private static let successPage = """
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <title>Signed in - College Compass</title>
    <style>
    :root { color-scheme: light dark; --bg: #f6f7fb; --card: #ffffff; --text: #111827; --muted: #4b5563; --accent: #2457d6; --on-accent: #ffffff; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0b0f19; --card: #151b2b; --text: #f3f4f6; --muted: #9ca3af; --accent: #6b93ff; --on-accent: #0b0f19; } }
    html, body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
    main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; box-sizing: border-box; }
    .card { background: var(--card); border-radius: 20px; padding: 28px 22px; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 6px 24px rgba(0,0,0,.08); }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { margin: 0 0 22px; color: var(--muted); }
    a.button { display: block; min-height: 48px; line-height: 48px; border-radius: 14px; background: var(--accent); color: var(--on-accent); text-decoration: none; font-weight: 600; }
    </style>
    </head>
    <body>
    <main>
    <div class="card">
    <h1>Signed in to College Compass</h1>
    <p>You can return to the app.</p>
    <a class="button" href="collegecompass://auth/done">Return to College Compass</a>
    </div>
    </main>
    </body>
    </html>
    """
}
