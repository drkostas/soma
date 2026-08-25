package dev.gkos.soma.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
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

    private fun render(context: Context, t: Today): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.soma_today)
        rv.setTextViewText(R.id.steps, t.steps.toString())
        rv.setTextViewText(R.id.active_kcal, t.activeKcal.toString())
        rv.setTextViewText(R.id.resting_hr, t.restingHr.toString())
        rv.setTextViewText(R.id.stress, t.stress.toString())
        rv.setTextColor(R.id.readiness_dot, readinessColor(t.readiness))
        rv.setTextViewText(R.id.readiness_label, t.readiness.replaceFirstChar { it.uppercase() })
        rv.setTextColor(R.id.readiness_label, readinessColor(t.readiness))
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
