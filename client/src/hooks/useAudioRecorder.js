// src/hooks/useAudioRecorder.js
// Custom hook for capturing microphone audio using MediaRecorder API

import { useRef, useCallback, useState } from 'react';

/**
 * Hook for recording audio from the user's microphone
 * @param {Object} opts
 * @param {Function} opts.onChunk - Called with each audio Blob chunk
 * @param {Function} opts.onStop  - Called when recording stops, with final Blob
 * @param {Function} opts.onError - Called on mic error
 */
export function useAudioRecorder({ onChunk, onStop, onError } = {}) {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState(null); // null = unknown

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setHasPermission(true);
      return stream;
    } catch (err) {
      setHasPermission(false);
      onError?.({ message: 'Microphone access denied. Please allow microphone access.' });
      return null;
    }
  }, [onError]);

  const startRecording = useCallback(async () => {
    chunksRef.current = [];

    let stream = streamRef.current;
    if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
      stream = await requestPermission();
      if (!stream) return;
    }

    // Prefer webm/opus for smaller size and Whisper compatibility
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
        onChunk?.(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setIsRecording(false);
      onStop?.(blob);
    };

    recorder.onerror = (e) => {
      setIsRecording(false);
      onError?.({ message: 'Recording error: ' + e.error?.message });
    };

    // Collect chunks every 250ms for streaming effect
    recorder.start(250);
    setIsRecording(true);
  }, [requestPermission, onChunk, onStop, onError]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cleanup = useCallback(() => {
    stopRecording();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [stopRecording]);

  return {
    isRecording,
    hasPermission,
    startRecording,
    stopRecording,
    cleanup,
    requestPermission,
  };
}
