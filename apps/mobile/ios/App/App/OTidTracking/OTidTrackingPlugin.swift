import Capacitor
import Foundation

/// Saknat värde blir `null` i svaret till webben.
private func orNull(_ value: Any?) -> Any { value ?? NSNull() }

/// Bryggan `window.Capacitor.Plugins.OTidTracking` (ADR-0227 beslut 2). Metodnamn, fält och händelser följer
/// kontraktet exakt; ändras de krävs en ny appversion och ett tillägg i ADR-0227.
@objc(OTidTrackingPlugin)
public class OTidTrackingPlugin: CAPPlugin, CAPBridgedPlugin, TrackingEngineListener {
    public let identifier = "OTidTrackingPlugin"
    public let jsName = "OTidTracking"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purge", returnType: CAPPluginReturnPromise)
    ]

    private static let formatVersion = 1
    private static let maxRead = 2000
    private static let postTimeout: TimeInterval = 15

    // Inga kakor: anropen är publika (ADR-0227 beslut 3).
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = OTidTrackingPlugin.postTimeout
        config.timeoutIntervalForResource = OTidTrackingPlugin.postTimeout
        return URLSession(configuration: config)
    }()

    override public func load() {
        let attach = { TrackingEngine.shared.listener = self }
        if Thread.isMainThread { attach() } else { DispatchQueue.main.sync(execute: attach) }
    }

    // MARK: - Hjälp

    private func required(_ call: CAPPluginCall, _ name: String) -> String? {
        guard let value = call.getString(name), !value.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("\(name) saknas")
            return nil
        }
        return value
    }

    private func int64(_ call: CAPPluginCall, _ name: String) -> Int64? {
        call.getDouble(name).map { Int64($0.rounded()) }
    }

    private func store(_ call: CAPPluginCall) -> TrackingStore? {
        let engine = TrackingEngine.shared
        guard let store = engine.store else {
            call.reject(engine.storeError ?? "Journalen saknas")
            return nil
        }
        return store
    }

    private func fail(_ call: CAPPluginCall, _ error: Error) {
        call.reject("\(call.methodName) misslyckades: \(error.localizedDescription)")
    }

    // MARK: - Metoder

    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            TrackingEngine.shared.requestPermission { call.resolve($0) }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let sessionId = required(call, "sessionId"), required(call, "title") != nil else { return }
        guard call.getString("text") != nil else { return call.reject("text saknas") }
        guard let stopAtMs = int64(call, "stopAtMs") else { return call.reject("stopAtMs saknas") }
        // title och text används inte på iOS: där visar systemet den blå platsindikatorn i stället för en notis.
        DispatchQueue.main.async {
            do {
                let lastSeq = try TrackingEngine.shared.start(sessionId: sessionId, stopAtMs: stopAtMs)
                call.resolve(["lastSeq": lastSeq])
            } catch {
                self.fail(call, error)
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let sessionId = required(call, "sessionId") else { return }
        DispatchQueue.main.async {
            do {
                try TrackingEngine.shared.stop(sessionId: sessionId, by: "user")
                call.resolve()
            } catch {
                self.fail(call, error)
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let engine = TrackingEngine.shared
            guard let store = self.store(call) else { return }
            let live = engine.sessionId
            do {
                let (state, lastSeq): (SessionState?, Int64) = try store.queue.sync {
                    guard let state = try store.state() else { return (nil, 0) }
                    let lastSeq = try store.lastSeq(state.sessionId)
                    return (state, lastSeq)
                }
                call.resolve([
                    "formatVersion": Self.formatVersion,
                    "tracking": state?.active == true && live != nil && live == state?.sessionId,
                    "sessionId": orNull(state?.sessionId),
                    "lastSeq": lastSeq,
                    "stopAtMs": orNull(state?.stopAtMs),
                    "stoppedBy": orNull(state?.stoppedBy)
                ])
            } catch {
                self.fail(call, error)
            }
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let sessionId = required(call, "sessionId"), let store = self.store(call) else { return }
        let afterSeq = int64(call, "afterSeq") ?? 0
        let limit = Int(max(0, min(Int64(Self.maxRead), int64(call, "limit") ?? Int64(Self.maxRead))))
        store.queue.async {
            do {
                let (fixes, lastSeq) = try store.read(sessionId, afterSeq: afterSeq, limit: limit)
                call.resolve(["fixes": fixes.map { $0.dictionary }, "lastSeq": lastSeq])
            } catch {
                self.fail(call, error)
            }
        }
    }

    @objc func purge(_ call: CAPPluginCall) {
        guard let sessionId = required(call, "sessionId"), let store = self.store(call) else { return }
        DispatchQueue.main.async {
            if TrackingEngine.shared.sessionId == sessionId {
                return call.reject("Spårningen pågår; stoppa den innan journalen tas bort")
            }
            store.queue.async {
                do {
                    try store.purge(sessionId)
                    call.resolve()
                } catch {
                    self.fail(call, error)
                }
            }
        }
    }

    @objc func post(_ call: CAPPluginCall) {
        guard let url = required(call, "url") else { return }
        guard let body = call.getString("body") else { return call.reject("body saknas (JSON som text)") }
        guard let server = bridge?.config.serverURL,
              let target = URL(string: url, relativeTo: server)?.absoluteURL,
              let scheme = server.scheme, let host = server.host else {
            return call.reject("Adressen kunde inte tolkas")
        }
        let basePath = server.path.hasSuffix("/") ? server.path : server.path + "/"
        guard target.scheme == scheme, target.host?.lowercased() == host.lowercased(), target.port == server.port,
              (target.path + "/").hasPrefix(basePath) else {
            return call.reject("Adressen ligger inte under appens serveradress (\(server.absoluteString))")
        }
        let origin = server.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
        var request = URLRequest(url: target, timeoutInterval: Self.postTimeout)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(origin, forHTTPHeaderField: "origin")
        request.httpBody = Data(body.utf8)
        session.dataTask(with: request) { data, response, error in
            if let error = error as? URLError, error.code == .timedOut {
                return call.reject("Servern svarade inte inom 15 s")
            }
            if let error = error {
                return call.reject("Kunde inte nå servern: \(error.localizedDescription)")
            }
            guard let http = response as? HTTPURLResponse else { return call.reject("Servern gav inget HTTP-svar") }
            call.resolve(["status": http.statusCode, "body": String(decoding: data ?? Data(), as: UTF8.self)])
        }.resume()
    }

    @objc func signal(_ call: CAPPluginCall) {
        let kind = call.getString("kind")
        guard kind == "ok" else { return call.reject("Okänd signal: \(kind ?? "saknas")") }
        DispatchQueue.main.async {
            do {
                try TrackingSignal.ok()
                call.resolve()
            } catch {
                call.reject("Signalen kunde inte ges: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Händelser

    func trackingDidRecord(_ fix: Fix) {
        notifyListeners("fix", data: fix.dictionary)
    }

    func trackingDidStop(sessionId: String, stoppedBy: String) {
        notifyListeners("stopped", data: ["sessionId": sessionId, "stoppedBy": stoppedBy])
    }
}
