/**
 * The Speak control, in one place for both boxes that have one.
 *
 * ⭐ THE RECORDING IS KEPT AND UPLOADED, which is the whole reason this is not four lines. The
 * phone's recogniser fills the box as he talks, because he has to see that it is working and be
 * able to fix a word. That transcript is not what the agent reads: a real model on the Mac reads
 * the recording afterwards, primed with his own food names, and that is what is logged. The phone's
 * words are the fallback.
 *
 * ⛔ THE AUDIO IS ONLY KEPT WHEN IT ACCOUNTS FOR THE WHOLE BOX. A better reading of the recording
 * REPLACES the text, so if he typed something first, or spoke twice, the recording covers only part
 * of what is in the box and replacing all of it would throw the rest away. In that case no audio is
 * sent and the phone's transcript stands, which is the behaviour this feature had before.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { heardNext, heardStart, heardText, speechOptions, type Heard } from "../lib/dictation";
import { uploadCaptureAudio, type PhotoUpload } from "../lib/meal-capture";
import { settle, SETTLE_MS } from "../lib/settle";

/** What to send with the message: the recording, and what the phone made of it. */
export interface Spoken { audio: string | null; heard: string | null }

export interface Dictation {
  recording: boolean;
  /** Press the control. Starts if idle, stops if recording. */
  toggle: () => void;
  /** Called at send time. Waits briefly for an upload still in flight. */
  spoken: () => Promise<Spoken>;
  /** After a send, so the next message does not inherit this one's recording. */
  clear: () => void;
  /** Why the microphone did not work, in words he can act on. */
  error: string | null;
  /** Null until the mic has been asked for, which the first press does. */
  permitted: boolean | null;
}

export function useDictation(opts: {
  /** The box's current text, read when recording starts. */
  value: string;
  /** Put the running transcript in the box. */
  onText: (next: string) => void;
  vocabulary: readonly string[];
  /** False while this box is not the one being typed into, so events are ignored. */
  active?: boolean;
}): Dictation {
  const { value, onText, vocabulary, active = true } = opts;
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permitted, setPermitted] = useState<boolean | null>(null);

  // The running text of the session. A continuous session on Android arrives in segments, so finals
  // are settled and partials replace only the guess in progress. See `dictation.ts`.
  const running = useRef<Heard>({ committed: "", live: "" });
  // What the recogniser last put in the box. The server compares the sent text against this to know
  // whether he corrected a word, in which case his correction wins over any better reading.
  const heard = useRef<string | null>(null);
  const ref = useRef<string | null>(null);
  const upload = useRef<Promise<PhotoUpload> | null>(null);
  // True only when the box was empty at the start of this recording. See the header.
  const whole = useRef(false);
  // The box's text, read when recording starts. Kept in a ref so the start handler does not need
  // to be rebuilt on every keystroke, and written in an effect because a ref must not be touched
  // during render.
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);

  useSpeechRecognitionEvent("result", (e) => {
    if (!active) return;
    running.current = heardNext(running.current, e.results?.[0]?.transcript ?? "", e.isFinal);
    const text = heardText(running.current);
    heard.current = text;
    onText(text);
  });

  useSpeechRecognitionEvent("end", () => setRecording(false));

  useSpeechRecognitionEvent("error", (e) => {
    setRecording(false);
    // "no-speech" is someone pressing it and saying nothing, which is not worth a message.
    if (e.error !== "no-speech" && e.error !== "aborted") setError("I could not hear that.");
  });

  useSpeechRecognitionEvent("audioend", (e) => {
    if (!e.uri || !whole.current) return;
    const p = uploadCaptureAudio(e.uri);
    upload.current = p;
    void p.then((up) => { if ("ref" in up) ref.current = up.ref; });
  });

  const toggle = useCallback(() => {
    if (recording) { ExpoSpeechRecognitionModule.stop(); return; }
    setError(null);
    void (async () => {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      setPermitted(perm.granted);
      if (!perm.granted) { setError("The microphone is not allowed for soma."); return; }
      running.current = heardStart(latest.current);
      // Keeping the audio needs Android 13 or newer, and it is only useful when the recording
      // accounts for the whole box. Without it the phone's transcript is all there is, which is
      // what this feature did before and still does on an older phone.
      const keep = ExpoSpeechRecognitionModule.supportsRecording() && latest.current.trim() === "";
      whole.current = keep;
      if (keep) { ref.current = null; upload.current = null; }
      setRecording(true);
      ExpoSpeechRecognitionModule.start(speechOptions(vocabulary, keep));
    })();
  }, [recording, vocabulary]);

  const spoken = useCallback(async (): Promise<Spoken> => {
    if (!whole.current) return { audio: null, heard: null };
    if (!ref.current) await settle(upload.current, SETTLE_MS);
    return { audio: ref.current, heard: heard.current };
  }, []);

  const clear = useCallback(() => {
    ref.current = null;
    upload.current = null;
    heard.current = null;
    whole.current = false;
    running.current = { committed: "", live: "" };
  }, []);

  return { recording, toggle, spoken, clear, error, permitted };
}
