/**
 * Say what you ate, from the phone.
 *
 * Voice costs nothing here: the keyboard's own microphone dictates into this text input, so no
 * audio library is bundled and no transcription service is involved. The agent's instructions
 * expect dictated text, which arrives unpunctuated and in one breath.
 *
 * Like the web box, it lets go of you immediately. The sentence is posted, an acknowledgement
 * appears, and the meal fills itself in behind you.
 */
import { forwardRef, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Text, Card, Button } from "soma-style";
import {
  captureAck, captureMeal, getCaptureMode, setCaptureMode, uploadCapturePhoto, type CaptureMode,
} from "../lib/meal-capture";

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
    const path = await uploadCapturePhoto(res.assets[0].uri);
    if (path) setImage(path); else setError("That photo would not upload.");
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
      const id = await captureMeal(text, image, mode);
      if (id == null) { setError("That did not send. Your words are still here."); return; }
      setAck(captureAck(mode));
      setText("");
      setImage(null);
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
      <View className="flex-row items-center gap-3 mt-2">
        <Pressable onPress={attach} testID="meal-capture-photo">
          <Text variant="caption" className="text-text-secondary">Photo</Text>
        </Pressable>
        <Pressable onPress={toggle} testID="meal-capture-toggle">
          <Text variant="caption" className="text-text-secondary">{mode === "calibrate" ? "☑" : "☐"} Let me check it first</Text>
        </Pressable>
        <View className="flex-1" />
        {ack ? <Text variant="caption" className="text-text-secondary">{ack}</Text> : null}
        {error ? <Text variant="caption" className="text-danger">{error}</Text> : null}
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
