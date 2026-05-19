;;; PULSE — Beat Link Trigger expressions
;;; Paste each block into the corresponding BLT expression editor.
;;;
;;; Setup: Triggers → Edit Trigger → set Watch to "Master Player"
;;;        Trigger Enabled: Always

;; ─── Global Setup Expression ──────────────────────────────────────────────────
;; (File → Edit Global Setup Expression)
;;
;; Opens the OSC connection to PULSE Conductor on startup.

(require '[overtone.osc :as osc])
(defonce pulse-client (osc/osc-client "127.0.0.1" 9000))
(println "[pulse] OSC client ready → 127.0.0.1:9000")


;; ─── Beat Expression ──────────────────────────────────────────────────────────
;; Fires on every beat of the Master player.
;; Bindings available: beat-number, bar-number, effective-tempo, status, player-number

(let [bpm (float effective-tempo)
      bar (int bar-number)]
  (osc/osc-send pulse-client "/beat" bpm)
  (osc/osc-send pulse-client "/bar"  bar))


;; ─── Tracked Update Expression ────────────────────────────────────────────────
;; Fires frequently (multiple times per beat) — used for smooth BPM tracking.
;; Bindings: effective-tempo, status

(osc/osc-send pulse-client "/bpm" (float effective-tempo))


;; ─── Activation Expression ────────────────────────────────────────────────────
;; Fires when a player comes on-air (fader open, playing).
;; Sends track metadata to PULSE.

(when-let [md (when status (.getMetadata status))]
  (let [title  (str (.getTitle  md))
        artist (str (.getArtist md))
        player (int (.getNumber status))]
    (osc/osc-send pulse-client "/track/changed"
                  title artist (float player))))


;; ─── Global Shutdown Expression ───────────────────────────────────────────────
;; (File → Edit Global Shutdown Expression)
;;
;; Clean up the OSC client when BLT exits.

(overtone.osc/osc-close pulse-client)
(println "[pulse] OSC client closed")
