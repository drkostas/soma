export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 prose prose-invert">
      <h1>Privacy Policy</h1>
      <p><strong>Last updated:</strong> March 17, 2026</p>

      <h2>Overview</h2>
      <p>
        Soma Health (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is a personal health intelligence platform
        that integrates data from wearable devices and fitness services to provide nutrition tracking,
        training plan management, and body composition analysis.
      </p>

      <h2>Data We Collect</h2>
      <ul>
        <li><strong>Garmin Connect data:</strong> Activity summaries, daily health metrics (heart rate, sleep, steps, stress), body composition, and workout data synced from your Garmin wearable device.</li>
        <li><strong>Hevy data:</strong> Strength training workout data including exercises, sets, reps, and duration.</li>
        <li><strong>Strava data:</strong> Activity data synced for cross-platform tracking.</li>
        <li><strong>User-entered data:</strong> Nutrition logs, meal plans, body measurements, and profile information.</li>
      </ul>

      <h2>How We Use Your Data</h2>
      <ul>
        <li>Calculate daily energy expenditure and calorie targets</li>
        <li>Generate and manage training plans</li>
        <li>Track body composition progress toward goals</li>
        <li>Provide sleep-adjusted nutrition recommendations</li>
        <li>Sync structured workouts to your Garmin device</li>
      </ul>

      <h2>Data Storage &amp; Security</h2>
      <p>
        Your data is stored securely in a Neon PostgreSQL database. We use HTTPS for all data transmission.
        Authentication is handled via GitHub OAuth with NextAuth.js. We do not sell, share, or distribute
        your personal data to any third parties.
      </p>

      <h2>Third-Party Services</h2>
      <p>
        We integrate with Garmin Connect, Hevy, and Strava to sync your fitness data. Each service has
        its own privacy policy. We only access data you explicitly authorize through OAuth consent flows.
      </p>

      <h2>Data Retention</h2>
      <p>
        Your data is retained as long as your account is active. You may request deletion of your data
        at any time by contacting us.
      </p>

      <h2>Your Rights</h2>
      <ul>
        <li>Access your personal data</li>
        <li>Request correction of inaccurate data</li>
        <li>Request deletion of your data</li>
        <li>Revoke access to connected services at any time</li>
      </ul>

      <h2>Contact</h2>
      <p>
        For privacy inquiries, contact us at{" "}
        <a href="mailto:kostas@gkos.dev">kostas@gkos.dev</a>.
      </p>
    </div>
  );
}
