/**
 * Say what you ate, from the phone.
 *
 * There is a Speak button, because the keyboard's own microphone key was not enough: it needs the
 * keyboard up, it is a different key on every keyboard, and the owner asked for one thing to press.
 * The phone's own recogniser fills the box while he talks, so he can see it working and fix a word,
 * and the recording itself is uploaded so a real model on the Mac can read it properly. All of that
 * lives in `use-dictation.ts`.
 *
 * Like the web box, it lets go of you immediately. The sentence is posted, an acknowledgement
 * appears, and the meal fills itself in behind you.
 */
import { forwardRef, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Text, Card, Button } from "soma-style";
import {
  captureAck, captureMeal, getCaptureMode, setCaptureMode, uploadCapturePhoto, type CaptureMode, fetchVocabulary,} from "../lib/meal-capture";
import { shrinkPhoto } from "../lib/shrink-photo";
import { TONE } from "../lib/capture-tone";
import { canDictate, dictateLabel } from "../lib/dictation";
import { useDictation } from "./use-dictation";

interface Props {
  slot: string;
  onCaptured?: (id: number) => void;
}

export const MealCaptureInput = forwardRef<TextInput, Props>(function MealCaptureInput(
  { slot, onCaptured }, ref,
) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode>("log");
  const [sending, setSending] = useState(false);
  const [ack, setAck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** His own food words, so neither recogniser is guessing at "loukoumades". */
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const speech = useDictation({ value: text, onText: setText, vocabulary });

  useEffect(() => {
    let alive = true;
    void fetchVocabulary().then((w) => { if (alive) setVocabulary(w); });
    return () => { alive = false; };
  }, []);

  // The remembered choice, so the toggle is set once and then forgotten.
  useEffect(() => {
    let alive = true;
    void getCaptureMode().then((m) => { if (alive) setMode(m); });
    return () => { alive = false; };
  }, []);

  const attach = async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const small = await shrinkPhoto(a.uri, a.width, a.height);
    const up = await uploadCapturePhoto(small);
    if ("ref" in up) setImage(up.ref); else setError(up.error);
  };

  const toggle = () => {
    const next: CaptureMode = mode === "log" ? "calibrate" : "log";
    setMode(next);
    void setCaptureMode(next);
  };

  const send = async () => {
    if (!text.trim() && !image) return;
    setSending(true);
    setError(null);
    try {
      const id = await captureMeal(text, image, mode, await speech.spoken());
      if (id == null) { setError("That did not send. Your words are still here."); return; }
      setAck(captureAck(mode));
      setText("");
      setImage(null);
      speech.clear();
      onCaptured?.(id);
      setTimeout(() => setAck(null), 5000);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <TextInput
        ref={ref}
        value={text}
        onChangeText={setText}
        placeholder={`What did you eat for ${slot.replace(/_/g, " ")}?`}
        placeholderTextColor="#5a7a8a"
        multiline
        style={{ color: "white", fontSize: 15, minHeight: 44, textAlignVertical: "top" }}
        testID="meal-capture-input"
      />
      {image ? (
        <Pressable onPress={() => setImage(null)}>
          <Text variant="caption" className="text-text-secondary">photo attached — tap to remove</Text>
        </Pressable>
      ) : null}
      {/* ⛔ Messages go ABOVE the control row, never inside it. Anything in that row shares the
          width with Send, and both times a message appeared there it pushed Send off the right
          edge of the phone. The error was moved once and the acknowledgement was left behind. */}
      {error ?? speech.error ? (
        <Text variant="caption" style={{ color: TONE.danger }} className="mt-1">{error ?? speech.error}</Text>
      ) : null}
      {ack && !error && !speech.error ? (
        <Text variant="caption" className="text-text-secondary mt-1">{ack}</Text>
      ) : null}
      <View className="flex-row items-center gap-3 mt-2">
        {canDictate(true, speech.permitted) ? (
          <Pressable onPress={speech.toggle} testID="meal-capture-speak">
            <Text variant="caption" style={{ color: speech.recording ? TONE.danger : TONE.quiet }}>
              {dictateLabel(speech.recording)}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={attach} testID="meal-capture-photo">
          <Text variant="caption" className="text-text-secondary">Photo</Text>
        </Pressable>
        <Pressable onPress={toggle} testID="meal-capture-toggle">
          <Text variant="caption" className="text-text-secondary">{mode === "calibrate" ? "☑" : "☐"} Let me check it first</Text>
        </Pressable>
        <View className="flex-1" />
        <Button
          label={sending ? "…" : "Send"}
          size="sm"
          disabled={sending || (!text.trim() && !image)}
          onPress={send}
          testID="meal-capture-send"
        />
      </View>
    </Card>
  );
});
