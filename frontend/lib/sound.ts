export const SOUND_DEFAULT_ON = false;

export class SoundTokenBatch {
  text: string;
  constructor(text = "") {
    this.text = text;
  }
}

const core = require("./sound.js") as {
  chatSound: {
    gesture: () => Promise<void>;
    tokens: (batch: SoundTokenBatch) => void;
    done: () => void;
    error: () => void;
    stop: (fade?: boolean) => void;
    unmount: () => void;
    setEnabled: (enabled: boolean) => void;
  };
};

export const chatSound = core.chatSound;
