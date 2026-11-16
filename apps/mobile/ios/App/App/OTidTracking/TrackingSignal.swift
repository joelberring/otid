import AudioToolbox
import Foundation

/// `signal({ kind: "ok" })`: kort vibration och kort ton. Systemljud följer ljudlägesknappen (tyst läge ger bara
/// vibration). Anropas från huvudtråden.
enum TrackingSignal {
    private static var soundId: SystemSoundID = 0

    static func ok() throws {
        let sound = try loadSound()
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        AudioServicesPlaySystemSound(sound)
    }

    private static func loadSound() throws -> SystemSoundID {
        if soundId != 0 { return soundId }
        let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil,
                                                 create: true)
        let url = caches.appendingPathComponent("otid-ok.wav")
        if !FileManager.default.fileExists(atPath: url.path) {
            try beepWav().write(to: url, options: .atomic)
        }
        var id: SystemSoundID = 0
        let status = AudioServicesCreateSystemSoundID(url as CFURL, &id)
        guard status == kAudioServicesNoError else { throw TrackingError("Ljudet kunde inte laddas (fel \(status))") }
        soundId = id
        return id
    }

    /// En kort ton (1 kHz, 0,25 s) som 16-bitars PCM-WAV, så att appen inte behöver en ljudfil.
    private static func beepWav() -> Data {
        let rate = 44_100
        let count = rate / 4
        var samples = Data(capacity: count * 2)
        for i in 0..<count {
            let fade = min(1.0, Double(min(i, count - i)) / 400.0)
            let value = sin(2 * Double.pi * 1000 * Double(i) / Double(rate)) * 0.8 * fade
            var sample = Int16(value * Double(Int16.max)).littleEndian
            withUnsafeBytes(of: &sample) { samples.append(contentsOf: $0) }
        }
        var wav = Data()
        func append32(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) } }
        func append16(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) } }
        wav.append(contentsOf: Array("RIFF".utf8))
        append32(UInt32(36 + samples.count))
        wav.append(contentsOf: Array("WAVEfmt ".utf8))
        append32(16)
        append16(1)
        append16(1)
        append32(UInt32(rate))
        append32(UInt32(rate * 2))
        append16(2)
        append16(16)
        wav.append(contentsOf: Array("data".utf8))
        append32(UInt32(samples.count))
        wav.append(samples)
        return wav
    }
}
