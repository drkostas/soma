/**
 * What became of the sentences you sent today, on the phone.
 *
 * This matters more here than on the website. The app posts to soma.gkos.dev, so the agent cannot
 * run in the request: the capture waits for the Mac to pick it up. Without this the screen was
 * identical whether a sentence was in flight or had never been sent.
 *
 * Polls only while something is still moving and stops by itself. The words come from
 * `capture-status.ts`, which is held identical to the website's copy by a drift test.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "soma-style";
import { anyInFlight, captureDetail, captureHeadline, shortAgo, stripCards, type CaptureCard } from "../lib/capture-status";
import { toneColor } from "../lib/capture-tone";
import { fetchRecentCaptures } from "../lib/meal-capture";

/** The agent takes tens of seconds, so four is live enough and costs nothing. */
const POLL_MS = 4000;

interface Props {
  /** The day the screen is showing. */
  date?: string;
  /** Bumped after a send, so a new capture appears without waiting for the poll. */
  version?: number;
}

export function MealCaptureStatus({ date, version = 0 }: Props) {
  const [cards, setCards] = useState<CaptureCard[]>([]);

  const load = useCallback(() => fetchRecentCaptures(date), [date]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await load();
      if (!alive) return;
      setCards(next);
      // A question counts as settled for the poller and open for the owner, so it stays on
      // screen without being asked about again.
      if (anyInFlight(next)) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [load, version]);

  // Everything in flight plus the last couple of finished ones, same as the website.
  const shown = stripCards(cards);
  if (!shown.length) return null;

  return (
    <View className="gap-2" testID="meal-capture-status">
      {shown.map((c) => {
        const detail = captureDetail(c);
        return (
          <View key={c.id} className="rounded-md border border-border-subtle bg-surface px-3 py-2">
            <View className="flex-row items-baseline gap-2">
              <Text variant="caption" style={{ color: toneColor(c), fontWeight: "600" }}>{captureHeadline(c)}</Text>
              {c.slot ? (
                <Text variant="caption" className="text-text-secondary">{c.slot.replace(/_/g, " ")}</Text>
              ) : null}
              <View className="flex-1" />
              <Text variant="caption" className="text-text-secondary">{shortAgo(c.updatedAt)}</Text>
            </View>
            {c.said ? (
              <Text variant="caption" className="text-text-secondary mt-0.5">{c.said}</Text>
            ) : null}
            {detail ? (
              <Text variant="caption" className="text-text-secondary mt-0.5">{detail}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
