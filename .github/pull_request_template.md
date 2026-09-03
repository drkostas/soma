<!-- The sentence before the code (soma follows drlab's intake gate, ../drlab docs/39).
     A slot you cannot fill is a finding about the MODEL, not a reason to code: write the
     finding and stop. A spike/* branch never merges. -->

## The sentence

```
For RESOURCE      <what this touches: e.g. ingredient://<slug>, service://soma-dj, screen://nutrition>,
  soma knows PROPERTIES <name := value; observed by WHOM; fresh for N>,
  and can do CAPABILITY <name; tier none|confirm|restricted; executor script|human|agent;
                          reversible|compensable|irreversible; shared|exclusive; batch|interactive|realtime>
  when INTENT is minted by <actor, at tier>,
  producing EVENTS <action; actor; origin commanded|observed|inferred; outcome>,
  or, for a human, PROCEDURE <steps; verify_cmd>,
  so that DERIVED STATE <what answers "is it done" with no stored flag>,
  rendered at TOUCHPOINTS <screens / endpoint / channel — render, declare, relay only>,
  governed by POLICY <rules, or "none today">.
```

## Done is an observation, not a claim

`verify_cmd` (runs on the Android emulator with the owner's account; the phone if a deviation is plausible):

```bash
universal/scripts/verify-device.sh <screen> [--marker "<live value>"]
```

- [ ] I ran it after the last commit and it exited 0 (paste the `VERIFIED …` line below).
- [ ] Reads came from the real API (soma.gkos.dev), not a mock and not Expo web.
- [ ] External writes: Spotify writes may be real; **Garmin writes stay mock unless the owner said go.**

```
<paste the VERIFIED line / evidence path here>
```

## Guardrails (tick each or explain)

- [ ] The sync pipeline and Strava bridge are untouched, or the change is reversible and `sync_health` was read before and after.
- [ ] hevy2garmin `main` still works for a fresh fork (fresh-fork check green) — or this PR does not touch it.
- [ ] Nutrition logging / presets / compose solver / adjusted targets untouched, or new behaviour is behind a flag.
- [ ] Garmin token store format untouched.
- [ ] No web-only feature was introduced; none was silently dropped from the app.

## Links

Closes #<issue>

https://claude.ai/code/session_017H7RibKwWqRZxuc5XrAWNF
