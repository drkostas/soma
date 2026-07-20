import WidgetKit
import SwiftUI

// MARK: - Palette (soma-style)
private let TEAL = Color(red: 0x77/255, green: 0xc8/255, blue: 0xd1/255)
private let BASE = Color(red: 0x0a/255, green: 0x17/255, blue: 0x20/255)
private let SURFACE = Color(red: 0x0e/255, green: 0x1a/255, blue: 0x26/255)
private let MUTED = Color(red: 0x5a/255, green: 0x7a/255, blue: 0x8a/255)
private let WARM = Color(red: 0xb1/255, green: 0x78/255, blue: 0x50/255)

// MARK: - Model
struct SomaEntry: TimelineEntry {
    let date: Date
    var steps: Int = 0
    var activeKcal: Int = 0
    var restingHr: Int = 0
    var stress: Int = 0
    var readiness: String = "unknown" // green | amber | red | unknown
    var ok: Bool = false
}

private func readinessColor(_ r: String) -> Color {
    switch r {
    case "green": return Color(red: 0x6a/255, green: 0xd4/255, blue: 0xa0/255)
    case "amber", "yellow": return Color(red: 0xe0/255, green: 0xa4/255, blue: 0x58/255)
    case "red": return Color(red: 0xe0/255, green: 0x60/255, blue: 0x60/255)
    default: return MUTED
    }
}

// MARK: - Networking (widget fetches its own data — no App Group needed on a free Apple ID)
private func authedRequest(_ path: String) -> URLRequest {
    var req = URLRequest(url: URL(string: SOMA_WIDGET_API + path)!)
    req.setValue("Bearer " + SOMA_WIDGET_TOKEN, forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 15
    req.cachePolicy = .reloadIgnoringLocalCacheData
    return req
}

private func todayString() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone.current
    return f.string(from: Date())
}

private func fetchEntry() async -> SomaEntry {
    var entry = SomaEntry(date: Date())
    do {
        async let healthData = URLSession.shared.data(for: authedRequest("/api/health/today"))
        async let readyData = URLSession.shared.data(for: authedRequest("/api/training/breakdown?date=\(todayString())"))

        let (hData, _) = try await healthData
        if let h = try JSONSerialization.jsonObject(with: hData) as? [String: Any] {
            entry.steps = (h["total_steps"] as? Int) ?? Int((h["total_steps"] as? Double) ?? 0)
            entry.activeKcal = (h["active_kilocalories"] as? Int) ?? Int((h["active_kilocalories"] as? Double) ?? 0)
            entry.restingHr = (h["resting_heart_rate"] as? Int) ?? Int((h["resting_heart_rate"] as? Double) ?? 0)
            entry.stress = (h["avg_stress_level"] as? Int) ?? Int((h["avg_stress_level"] as? Double) ?? 0)
            entry.ok = true
        }
        if let (rData, _) = try? await readyData,
           let r = try? JSONSerialization.jsonObject(with: rData) as? [String: Any],
           let readiness = r["readiness"] as? [String: Any],
           let light = readiness["traffic_light"] as? String {
            entry.readiness = light
        }
    } catch {
        entry.ok = false
    }
    return entry
}

// MARK: - Timeline
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SomaEntry {
        SomaEntry(date: Date(), steps: 6420, activeKcal: 340, restingHr: 52, stress: 28, readiness: "green", ok: true)
    }
    func getSnapshot(in context: Context, completion: @escaping (SomaEntry) -> Void) {
        Task { completion(await fetchEntry()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SomaEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            // iOS budgets widget refreshes; ~every 30 min is plenty for a daily-metrics widget.
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Views
private struct Metric: View {
    let value: String
    let label: String
    var tint: Color = .white
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(tint)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(MUTED)
        }
    }
}

struct SomaWidgetView: View {
    var entry: SomaEntry
    @Environment(\.widgetFamily) var family

    private var header: some View {
        HStack(spacing: 5) {
            Text("SOMA").font(.system(size: 10, weight: .heavy)).foregroundStyle(TEAL).tracking(1.5)
            Circle().fill(readinessColor(entry.readiness)).frame(width: 7, height: 7)
            Spacer()
            Text("today").font(.system(size: 9, weight: .semibold)).foregroundStyle(MUTED)
        }
    }

    var body: some View {
        if family == .systemSmall {
            VStack(alignment: .leading, spacing: 6) {
                header
                Spacer(minLength: 0)
                Text("\(entry.steps)").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text("steps").font(.system(size: 10, weight: .semibold)).foregroundStyle(MUTED)
                Spacer(minLength: 0)
                HStack {
                    Metric(value: "\(entry.activeKcal)", label: "ACTIVE KCAL", tint: WARM)
                    Spacer()
                    Metric(value: "\(entry.restingHr)", label: "RESTING HR", tint: TEAL)
                }
            }
            .padding(14)
            .containerBackground(BASE, for: .widget)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                header
                Text("\(entry.steps)").font(.system(size: 40, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    + Text("  steps").font(.system(size: 13, weight: .semibold)).foregroundStyle(MUTED)
                Spacer(minLength: 0)
                HStack(spacing: 0) {
                    Metric(value: "\(entry.activeKcal)", label: "ACTIVE KCAL", tint: WARM); Spacer()
                    Metric(value: "\(entry.restingHr)", label: "RESTING HR", tint: TEAL); Spacer()
                    Metric(value: "\(entry.stress)", label: "AVG STRESS"); Spacer()
                    Metric(value: entry.readiness.capitalized, label: "READINESS", tint: readinessColor(entry.readiness))
                }
            }
            .padding(16)
            .containerBackground(BASE, for: .widget)
        }
    }
}

struct widget: Widget {
    let kind: String = "SomaWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            SomaWidgetView(entry: entry)
        }
        .configurationDisplayName("Soma Today")
        .description("Steps, active calories, resting HR, and training readiness.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#Preview(as: .systemSmall) {
    widget()
} timeline: {
    SomaEntry(date: .now, steps: 6420, activeKcal: 340, restingHr: 52, stress: 28, readiness: "green", ok: true)
}
