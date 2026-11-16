import CoreLocation
import Foundation
import UIKit
import UserNotifications

protocol TrackingEngineListener: AnyObject {
    func trackingDidRecord(_ fix: Fix)
    func trackingDidStop(sessionId: String, stoppedBy: String)
}

/// Platsinsamlingen under ett lopp (ADR-0227 beslut 4): «När appen används» med bakgrundsläget location,
/// blå indikator i statusfältet, ingen automatisk paus. Används bara från huvudtråden.
final class TrackingEngine: NSObject, CLLocationManagerDelegate {
    static let shared = TrackingEngine()

    /// Nil om journalens katalog inte kunde öppnas; då avvisas alla anrop med `storeError`.
    let store: TrackingStore?
    let storeError: String?
    weak var listener: TrackingEngineListener?

    private let manager = CLLocationManager()
    private(set) var sessionId: String?
    private var stopAtMs: Int64 = 0
    private var deadlineTimer: Timer?
    private var permissionWaiters: [() -> Void] = []

    private override init() {
        var opened: TrackingStore?
        var openError: String?
        do {
            opened = try TrackingStore()
        } catch {
            openError = "Journalen kunde inte öppnas: \(error.localizedDescription)"
            NSLog("OTidTracking: %@", openError ?? "")
        }
        store = opened
        storeError = openError
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        // En ny process spårar inte: ett lopp som stod som aktivt avbröts av systemet.
        if let store = store {
            store.queue.sync {
                do {
                    if let state = try store.state(), state.active {
                        _ = try store.markStopped(state.sessionId, by: "system")
                    }
                } catch {
                    NSLog("OTidTracking: kunde inte läsa spårningens läge: %@", error.localizedDescription)
                }
            }
        }
    }

    static func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

    // MARK: - Tillstånd

    func permissionResult(_ completion: @escaping ([String: Any]) -> Void) {
        let location: String
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: location = "granted"
        case .denied, .restricted: location = "denied"
        case .notDetermined: location = "prompt"
        @unknown default: location = "prompt"
        }
        let precise = manager.accuracyAuthorization == .fullAccuracy && location == "granted"
        // iOS visar ingen notis under spårningen (den blå indikatorn räcker); svaret är bara telefonens läge.
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let notifications: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: notifications = "granted"
            case .denied: notifications = "denied"
            case .notDetermined: notifications = "prompt"
            @unknown default: notifications = "prompt"
            }
            DispatchQueue.main.async {
                completion(["location": location, "precise": precise, "notifications": notifications])
            }
        }
    }

    func requestPermission(_ completion: @escaping ([String: Any]) -> Void) {
        switch manager.authorizationStatus {
        case .notDetermined:
            permissionWaiters.append { [weak self] in self?.requestPrecise(completion) }
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            requestPrecise(completion)
        default:
            permissionResult(completion)
        }
    }

    // Har användaren valt ungefärlig plats ber appen om exakt plats för den här användningen.
    private func requestPrecise(_ completion: @escaping ([String: Any]) -> Void) {
        let status = manager.authorizationStatus
        guard (status == .authorizedWhenInUse || status == .authorizedAlways),
              manager.accuracyAuthorization == .reducedAccuracy else {
            permissionResult(completion)
            return
        }
        manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "Orientering") { [weak self] _ in
            DispatchQueue.main.async { self?.permissionResult(completion) }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status != .notDetermined {
            let waiters = permissionWaiters
            permissionWaiters.removeAll()
            waiters.forEach { $0() }
        }
        guard sessionId != nil else { return }
        if status != .authorizedWhenInUse && status != .authorizedAlways {
            stopTracking(by: "system")
        } else if manager.accuracyAuthorization != .fullAccuracy {
            // Ungefärlig plats ger positioner som inte går att spela med; appen spårar inte.
            stopTracking(by: "system")
        }
    }

    // MARK: - Start och stopp

    func start(sessionId requested: String, stopAtMs: Int64) throws -> Int64 {
        guard let store = store else { throw TrackingError(storeError ?? "Journalen saknas") }
        guard UIApplication.shared.applicationState == .active else {
            throw TrackingError("Appen måste synas när spårningen startas")
        }
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            throw TrackingError("Appen har inte tillstånd till platsen")
        }
        guard manager.accuracyAuthorization == .fullAccuracy else {
            throw TrackingError("Exakt plats är avstängd för O-Tid")
        }
        guard stopAtMs > Self.nowMs() else { throw TrackingError("Maxtiden har redan passerat") }
        if let current = sessionId, current != requested {
            throw TrackingError("Spårning pågår redan för ett annat lopp")
        }
        let lastSeq: Int64 = try store.queue.sync {
            try store.saveState(SessionState(sessionId: requested, stopAtMs: stopAtMs, active: true, stoppedBy: nil))
            return try store.lastSeq(requested)
        }
        self.sessionId = requested
        self.stopAtMs = stopAtMs
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
        scheduleDeadline()
        return lastSeq
    }

    /// Stoppar spårningen. Ett lopp som bara står som aktivt på disk (t.ex. efter omstart) markeras också.
    func stop(sessionId requested: String, by reason: String) throws {
        if sessionId == requested {
            stopTracking(by: reason)
            return
        }
        guard let store = store else { throw TrackingError(storeError ?? "Journalen saknas") }
        let changed = try store.queue.sync { try store.markStopped(requested, by: reason) }
        if changed { listener?.trackingDidStop(sessionId: requested, stoppedBy: reason) }
    }

    private func stopTracking(by reason: String) {
        guard let id = sessionId else { return }
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        deadlineTimer?.invalidate()
        deadlineTimer = nil
        sessionId = nil
        let listener = self.listener
        let store = self.store
        store?.queue.async {
            do {
                _ = try store?.markStopped(id, by: reason)
            } catch {
                NSLog("OTidTracking: kunde inte spara att spårningen stoppades: %@", error.localizedDescription)
            }
            // Händelsen skickas även om läget inte kunde sparas: spårningen har stoppats.
            listener?.trackingDidStop(sessionId: id, stoppedBy: reason)
        }
    }

    // Timer i processen och kontroll vid varje punkt (appen körs i bakgrunden så länge platsen följs).
    private func scheduleDeadline() {
        deadlineTimer?.invalidate()
        let fireAt = Date(timeIntervalSince1970: TimeInterval(stopAtMs) / 1000)
        let timer = Timer(fire: fireAt, interval: 0, repeats: false) { [weak self] _ in
            self?.stopTracking(by: "deadline")
        }
        RunLoop.main.add(timer, forMode: .common)
        deadlineTimer = timer
    }

    // MARK: - Positioner

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let id = sessionId, let store = store else { return }
        let listener = self.listener
        for location in locations {
            let receivedAt = Self.nowMs()
            if receivedAt >= stopAtMs {
                stopTracking(by: "deadline")
                return
            }
            // Negativ noggrannhet betyder att positionen är ogiltig.
            guard location.horizontalAccuracy >= 0 else { continue }
            let t = Int64((location.timestamp.timeIntervalSince1970 * 1000).rounded())
            store.queue.async { [weak self] in
                do {
                    let fix = try store.append(id, latitude: location.coordinate.latitude,
                                               longitude: location.coordinate.longitude,
                                               accuracyM: location.horizontalAccuracy, t: t, receivedAt: receivedAt)
                    listener?.trackingDidRecord(fix)
                } catch {
                    // Utan journal finns ingen säker punkt att lämna; spårningen stoppas synligt.
                    NSLog("OTidTracking: kunde inte skriva punkten: %@", error.localizedDescription)
                    DispatchQueue.main.async { self?.stopTracking(by: "system") }
                }
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        if code == .denied {
            stopTracking(by: "system")
        } else {
            // locationUnknown är tillfälligt; CoreLocation fortsätter försöka.
            NSLog("OTidTracking: platsfel: %@", error.localizedDescription)
        }
    }
}
