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
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  ExpoSpeechRecognitionModule, useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { Text, Button } from "soma-style";
import {
  anyInFlight, captureDetail, captureHeadline, replyHint, shortAgo, stripCards, type CaptureCard,
} from "../lib/capture-status";
import { TONE, toneColor } from "../lib/capture-tone";
import { canDictate, dictateLabel, mergeTranscript } from "../lib/dictation";
import { fetchRecentCaptures, replyToCapture, uploadCapturePhoto } from "../lib/meal-capture";

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
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [replyImage, setReplyImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [bump, setBump] = useState(0);
  const dictationBase = useRef("");

  useSpeechRecognitionEvent("result", (e) => {
    if (replyTo == null) return;
    setReply(mergeTranscript(dictationBase.current, e.results?.[0]?.transcript ?? ""));
  });
  useSpeechRecognitionEvent("end", () => setRecording(false));
  useSpeechRecognitionEvent("error", () => setRecording(false));

  const dictate = async () => {
    if (recording) { ExpoSpeechRecognitionModule.stop(); return; }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return;
    dictationBase.current = reply;
    setRecording(true);
    ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true, continuous: false, addsPunctuation: false });
  };

  const attach = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const up = await uploadCapturePhoto(res.assets[0].uri);
    if ("ref" in up) { setReplyImage(up.ref); setReplyError(null); } else setReplyError(up.error);
  };

  const submitReply = async (id: number) => {
    if (!reply.trim() && !replyImage) return;
    setSending(true);
    const ok = await replyToCapture(id, reply, replyImage);
    setSending(false);
    if (!ok) return;
    setReplyTo(null); setReply(""); setReplyImage(null);
    // Back to `captured`, so restart the poll to follow it.
    setBump((b) => b + 1);
  };

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
  }, [load, version, bump]);

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

            {replyTo === c.id ? (
              <View className="mt-2 gap-2">
                <TextInput
                  autoFocus
                  value={reply}
                  onChangeText={setReply}
                  placeholder={c.question ? "Tell it what you ate" : "What should change?"}
                  placeholderTextColor="#5a7a8a"
                  style={{ color: "white", fontSize: 14, minHeight: 36 }}
                  testID={`capture-reply-${c.id}`}
                />
                {replyError ? (
                  <Text variant="caption" style={{ color: TONE.danger }}>{replyError}</Text>
                ) : null}
                <View className="flex-row items-center gap-3">
                  {canDictate(true, null) ? (
                    <Pressable onPress={dictate} testID={`capture-reply-speak-${c.id}`}>
                      <Text variant="caption" style={{ color: recording ? TONE.danger : TONE.quiet }}>
                        {dictateLabel(recording)}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={attach} testID={`capture-reply-photo-${c.id}`}>
                    <Text variant="caption" className="text-text-secondary">{replyImage ? "photo ready" : "Photo"}</Text>
                  </Pressable>
                  <View className="flex-1" />
                  <Pressable onPress={() => setReplyTo(null)}>
                    <Text variant="caption" className="text-text-secondary">Cancel</Text>
                  </Pressable>
                  <Button label={sending ? "…" : "Send"} size="sm"
                    disabled={sending || (!reply.trim() && !replyImage)}
                    onPress={() => void submitReply(c.id)} testID={`capture-reply-send-${c.id}`} />
                </View>
              </View>
            ) : (
              <Pressable onPress={() => { setReplyTo(c.id); setReply(""); setReplyImage(null); }}
                testID={`capture-reply-open-${c.id}`}>
                <Text variant="caption" className="text-text-secondary mt-1">{replyHint(c)}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
