/**
 * Say what you ate, from the phone.
 *
 * There is a Speak button, because the keyboard's own microphone key was not enough: it needs the
 * keyboard up, it is a different key on every keyboard, and the owner asked for one thing to press.
 * Recognition happens on the device through Android's `SpeechRecognizer` or iOS's
 * `SFSpeechRecognizer`, so no audio leaves the phone, nothing is uploaded and no transcription
 * service is involved. The agent's instructions already expect dictated text, which arrives
 * unpunctuated and in one breath.
 *
 * The transcript lands in this box rather than sending on its own, so a mis-heard word can be
 * fixed before it goes.
 *
 * Like the web box, it lets go of you immediately. The sentence is posted, an acknowledgement
 * appears, and the meal fills itself in behind you.
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  ExpoSpeechRecognitionModule, useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { Text, Card, Button } from "soma-style";
import {
  captureAck, captureMeal, getCaptureMode, setCaptureMode, uploadCapturePhoto, type CaptureMode,
} from "../lib/meal-capture";
import { canDictate, dictateLabel, mergeTranscript } from "../lib/dictation";

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
  const [recording, setRecording] = useState(false);
  // null until the mic has been asked for, which the first tap does.
  const [permitted, setPermitted] = useState<boolean | null>(null);
  // What was in the box when recording started. Recognition revises the whole utterance on every
  // event, so each result is merged onto this rather than appended to the visible text.
  const dictationBase = useRef("");

  // The remembered choice, so the toggle is set once and then forgotten.
  useEffect(() => {
    let alive = true;
    void getCaptureMode().then((m) => { if (alive) setMode(m); });
    return () => { alive = false; };
  }, []);

  useSpeechRecognitionEvent("result", (e) => {
    const said = e.results?.[0]?.transcript ?? "";
    setText(mergeTranscript(dictationBase.current, said));
  });
  useSpeechRecognitionEvent("end", () => setRecording(false));
  useSpeechRecognitionEvent("error", (e) => {
    setRecording(false);
    // "no-speech" is someone pressing it and saying nothing, which is not worth a message.
    if (e.error !== "no-speech" && e.error !== "aborted") setError("I could not hear that.");
  });

  const dictate = async () => {
    if (recording) { ExpoSpeechRecognitionModule.stop(); return; }
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    setPermitted(perm.granted);
    if (!perm.granted) { setError("The microphone is not allowed for soma."); return; }
    dictationBase.current = text;
    setRecording(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      // Interim results are what make it feel live: the words appear as they are said.
      interimResults: true,
      continuous: false,
      // On-device where the phone can, so nothing is sent anywhere.
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
    });
  };

  const attach = async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const up = await uploadCapturePhoto(res.assets[0].uri);
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
      {error ? (
        <Text variant="caption" style={{ color: "#e06060" }} className="mt-1">{error}</Text>
      ) : null}
      <View className="flex-row items-center gap-3 mt-2">
        {canDictate(true, permitted) ? (
          <Pressable onPress={dictate} testID="meal-capture-speak">
            <Text variant="caption" style={{ color: recording ? "#e06060" : "#a0b4c0" }}>
              {dictateLabel(recording)}
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
        {ack ? <Text variant="caption" className="text-text-secondary">{ack}</Text> : null}
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
