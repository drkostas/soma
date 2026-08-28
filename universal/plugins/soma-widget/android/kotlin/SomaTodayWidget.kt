package dev.gkos.soma.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Build
import android.util.SizeF
import android.widget.RemoteViews
import dev.gkos.soma.R
import kotlin.concurrent.thread

/**
 * "Soma Today" home-screen widget: steps, active calories, resting HR, avg stress,
 * and training readiness. Parity with the iOS systemMedium widget (widgets.swift).
 */
class SomaTodayWidget : AppWidgetProvider() {

    private data class Today(
        val steps: Int,
        val activeKcal: Int,
        val restingHr: Int,
        val stress: Int,
        val readiness: String
    )

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        val result = goAsync()
        thread {
            try {
                val t = fetch()
                for (id in ids) mgr.updateAppWidget(id, render(context, t))
            } catch (_: Throwable) {
            } finally {
                result.finish()
            }
        }
    }

    private fun fetch(): Today {
        val h = Net.get("/api/health/today")
        return Today(
            steps = jInt(h, "total_steps"),
            activeKcal = jInt(h, "active_kilocalories"),
            restingHr = jInt(h, "resting_heart_rate"),
            stress = jInt(h, "avg_stress_level"),
            readiness = fetchReadiness()
        )
    }

    /** Most recent day that has readiness (fall back up to 2 days, like iOS). */
    private fun fetchReadiness(): String {
        for (off in intArrayOf(0, -1, -2)) {
            val j = Net.get("/api/training/breakdown?date=" + ymd(off)) ?: continue
            val r = j.optJSONObject("readiness") ?: continue
            val light = r.optString("traffic_light", "")
            if (light.isNotEmpty()) return light
        }
        return "unknown"
    }

    /**
     * Responsive: a compact 2x2 layout when small, the full layout when wider.
     * Android 12+ (API 31) picks the largest mapped layout that fits; below that
     * we fall back to the full layout.
     */
    private fun render(context: Context, t: Today): RemoteViews {
        val full = bind(context, R.layout.soma_today, t, small = false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val small = bind(context, R.layout.soma_today_small, t, small = true)
            return RemoteViews(
                mapOf(
                    SizeF(120f, 100f) to small,
                    SizeF(220f, 100f) to full
                )
            )
        }
        return full
    }

    /** Binds the fields present in the given layout (small omits stress + readiness label). */
    private fun bind(context: Context, layoutId: Int, t: Today, small: Boolean): RemoteViews {
        val rv = RemoteViews(context.packageName, layoutId)
        rv.setTextViewText(R.id.steps, t.steps.toString())
        rv.setTextViewText(R.id.active_kcal, t.activeKcal.toString())
        rv.setTextViewText(R.id.resting_hr, t.restingHr.toString())
        rv.setTextColor(R.id.readiness_dot, readinessColor(t.readiness))
        if (!small) {
            rv.setTextViewText(R.id.stress, t.stress.toString())
            rv.setTextViewText(R.id.readiness_label, t.readiness.replaceFirstChar { it.uppercase() })
            rv.setTextColor(R.id.readiness_label, readinessColor(t.readiness))
        }
        openApp(context)?.let { rv.setOnClickPendingIntent(R.id.root, it) }
        return rv
    }

    private fun openApp(context: Context): PendingIntent? {
        val i = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        return PendingIntent.getActivity(
            context, 0, i,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }
}
