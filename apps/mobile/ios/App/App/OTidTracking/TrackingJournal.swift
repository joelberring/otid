import CryptoKit
import Foundation

struct TrackingError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// En punkt i journalen, med fälten i bryggans kontrakt (ADR-0227 beslut 2).
struct Fix {
    let seq: Int64
    let latitude: Double
    let longitude: Double
    let accuracyM: Double?
    let t: Int64
    let receivedAt: Int64

    var dictionary: [String: Any] {
        [
            "seq": seq,
            "latitude": latitude,
            "longitude": longitude,
            "accuracyM": accuracyM.map { $0 as Any } ?? NSNull(),
            "t": t,
            "receivedAt": receivedAt
        ]
    }

    init(seq: Int64, latitude: Double, longitude: Double, accuracyM: Double?, t: Int64, receivedAt: Int64) {
        self.seq = seq
        self.latitude = latitude
        self.longitude = longitude
        self.accuracyM = accuracyM
        self.t = t
        self.receivedAt = receivedAt
    }

    init(line: Data, file: String) throws {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let seq = object["seq"] as? NSNumber,
              let latitude = object["latitude"] as? NSNumber,
              let longitude = object["longitude"] as? NSNumber,
              let t = object["t"] as? NSNumber,
              let receivedAt = object["receivedAt"] as? NSNumber else {
            throw TrackingError("Journalen \(file) har en trasig rad")
        }
        self.init(seq: seq.int64Value, latitude: latitude.doubleValue, longitude: longitude.doubleValue,
                  accuracyM: (object["accuracyM"] as? NSNumber)?.doubleValue, t: t.int64Value,
                  receivedAt: receivedAt.int64Value)
    }
}

/// Loppets läge som överlever att appen startas om. `active` betyder att spårningen ska pågå.
struct SessionState: Codable {
    let sessionId: String
    let stopAtMs: Int64
    let active: Bool
    let stoppedBy: String?
}

private let fileProtection: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]

/// Journal för ett lopp: en JSON-rad per punkt, synkad till disk innan punkten lämnas vidare.
/// En halvskriven sista rad efter ett avbrott kapas när journalen öppnas.
final class TrackingJournal {
    private let url: URL
    private(set) var lastSeq: Int64 = 0
    private var handle: FileHandle?

    init(url: URL) throws {
        self.url = url
        lastSeq = try recover()
    }

    private func lines(_ data: Data) -> [Data] {
        data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: true).map { Data($0) }
    }

    private func recover() throws -> Int64 {
        guard FileManager.default.fileExists(atPath: url.path) else { return 0 }
        let data = try Data(contentsOf: url)
        let end = (data.lastIndex(of: UInt8(ascii: "\n")).map { $0 + 1 }) ?? data.startIndex
        if end < data.endIndex {
            // Avbrott mitt i en skrivning: resten efter sista radslutet är ingen hel punkt.
            let writer = try FileHandle(forWritingTo: url)
            try writer.truncate(atOffset: UInt64(end - data.startIndex))
            try writer.close()
        }
        guard let last = lines(data[data.startIndex..<end]).last else { return 0 }
        return try Fix(line: last, file: url.lastPathComponent).seq
    }

    func append(latitude: Double, longitude: Double, accuracyM: Double?, t: Int64, receivedAt: Int64) throws -> Fix {
        let fix = Fix(seq: lastSeq + 1, latitude: latitude, longitude: longitude, accuracyM: accuracyM, t: t,
                      receivedAt: receivedAt)
        if handle == nil {
            if !FileManager.default.fileExists(atPath: url.path) {
                guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: fileProtection) else {
                    throw TrackingError("Kunde inte skapa journalen")
                }
            }
            let opened = try FileHandle(forWritingTo: url)
            try opened.seekToEnd()
            handle = opened
        }
        var line = try JSONSerialization.data(withJSONObject: fix.dictionary)
        line.append(UInt8(ascii: "\n"))
        try handle?.write(contentsOf: line)
        try handle?.synchronize()
        lastSeq = fix.seq
        return fix
    }

    func read(afterSeq: Int64, limit: Int) throws -> [Fix] {
        guard limit > 0, FileManager.default.fileExists(atPath: url.path) else { return [] }
        var result: [Fix] = []
        for line in lines(try Data(contentsOf: url)) {
            let fix = try Fix(line: line, file: url.lastPathComponent)
            if fix.seq <= afterSeq { continue }
            result.append(fix)
            if result.count >= limit { break }
        }
        return result
    }

    func close() throws {
        try handle?.close()
        handle = nil
    }
}

/// Journaler och loppets läge på disk. Alla anrop sker på `queue`.
/// Katalogen ligger i Application Support och är undantagen från säkerhetskopian (isExcludedFromBackup).
final class TrackingStore {
    let queue = DispatchQueue(label: "se.berring.otid.journal")
    private let dir: URL
    private var journal: TrackingJournal?
    private var journalSessionId: String?

    init() throws {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        var dir = support.appendingPathComponent("otid-tracking", isDirectory: true)
        // Skrivbar med låst skärm (efter första upplåsningen sedan omstart).
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: fileProtection)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try dir.setResourceValues(values)
        self.dir = dir
    }

    // Filnamn ur en hash, så att sessionId aldrig blir en sökväg.
    private func journalURL(_ sessionId: String) -> URL {
        let hex = SHA256.hash(data: Data(sessionId.utf8)).map { String(format: "%02x", $0) }.joined()
        return dir.appendingPathComponent(hex + ".jsonl")
    }

    private var stateURL: URL { dir.appendingPathComponent("state.json") }

    func state() throws -> SessionState? {
        guard FileManager.default.fileExists(atPath: stateURL.path) else { return nil }
        return try JSONDecoder().decode(SessionState.self, from: Data(contentsOf: stateURL))
    }

    func saveState(_ state: SessionState?) throws {
        guard let state = state else {
            if FileManager.default.fileExists(atPath: stateURL.path) { try FileManager.default.removeItem(at: stateURL) }
            return
        }
        try JSONEncoder().encode(state).write(to: stateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func open(_ sessionId: String) throws -> TrackingJournal {
        if let journal = journal, journalSessionId == sessionId { return journal }
        try journal?.close()
        let opened = try TrackingJournal(url: journalURL(sessionId))
        journal = opened
        journalSessionId = sessionId
        return opened
    }

    private func exists(_ sessionId: String) -> Bool {
        journalSessionId == sessionId || FileManager.default.fileExists(atPath: journalURL(sessionId).path)
    }

    func lastSeq(_ sessionId: String) throws -> Int64 {
        guard exists(sessionId) else { return 0 }
        return try open(sessionId).lastSeq
    }

    func append(_ sessionId: String, latitude: Double, longitude: Double, accuracyM: Double?, t: Int64,
                receivedAt: Int64) throws -> Fix {
        try open(sessionId).append(latitude: latitude, longitude: longitude, accuracyM: accuracyM, t: t,
                                   receivedAt: receivedAt)
    }

    func read(_ sessionId: String, afterSeq: Int64, limit: Int) throws -> ([Fix], Int64) {
        guard exists(sessionId) else { return ([], 0) }
        let opened = try open(sessionId)
        let fixes = try opened.read(afterSeq: afterSeq, limit: limit)
        return (fixes, opened.lastSeq)
    }

    func purge(_ sessionId: String) throws {
        if journalSessionId == sessionId {
            try journal?.close()
            journal = nil
            journalSessionId = nil
        }
        let url = journalURL(sessionId)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        if try state()?.sessionId == sessionId { try saveState(nil) }
    }

    /// Sant om läget ändrades (loppet var aktivt).
    func markStopped(_ sessionId: String, by stoppedBy: String) throws -> Bool {
        guard let current = try state(), current.sessionId == sessionId, current.active else { return false }
        try saveState(SessionState(sessionId: sessionId, stopAtMs: current.stopAtMs, active: false, stoppedBy: stoppedBy))
        return true
    }
}
