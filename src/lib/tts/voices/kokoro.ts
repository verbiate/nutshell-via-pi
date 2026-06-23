export interface KokoroVoice {
  id: string;
  label: string;
  gender: "female" | "male";
  region?: "US" | "GB";
}

export const KOKORO_VOICES: Record<string, KokoroVoice[]> = {
  en: [
    // US female
    { id: "af_alloy", label: "Alloy", gender: "female", region: "US" },
    { id: "af_aoede", label: "Aoede", gender: "female", region: "US" },
    { id: "af_bella", label: "Bella", gender: "female", region: "US" },
    { id: "af_heart", label: "Heart", gender: "female", region: "US" },
    { id: "af_jessica", label: "Jessica", gender: "female", region: "US" },
    { id: "af_kore", label: "Kore", gender: "female", region: "US" },
    { id: "af_nicole", label: "Nicole", gender: "female", region: "US" },
    { id: "af_nova", label: "Nova", gender: "female", region: "US" },
    { id: "af_river", label: "River", gender: "female", region: "US" },
    { id: "af_sarah", label: "Sarah", gender: "female", region: "US" },
    { id: "af_sky", label: "Sky", gender: "female", region: "US" },
    // US male
    { id: "am_adam", label: "Adam", gender: "male", region: "US" },
    { id: "am_echo", label: "Echo", gender: "male", region: "US" },
    { id: "am_eric", label: "Eric", gender: "male", region: "US" },
    { id: "am_fenrir", label: "Fenrir", gender: "male", region: "US" },
    { id: "am_liam", label: "Liam", gender: "male", region: "US" },
    { id: "am_michael", label: "Michael", gender: "male", region: "US" },
    { id: "am_onyx", label: "Onyx", gender: "male", region: "US" },
    { id: "am_puck", label: "Puck", gender: "male", region: "US" },
    { id: "am_santa", label: "Santa", gender: "male", region: "US" },
    // GB female
    { id: "bf_alice", label: "Alice", gender: "female", region: "GB" },
    { id: "bf_emma", label: "Emma", gender: "female", region: "GB" },
    { id: "bf_isabella", label: "Isabella", gender: "female", region: "GB" },
    { id: "bf_lily", label: "Lily", gender: "female", region: "GB" },
    // GB male
    { id: "bm_daniel", label: "Daniel", gender: "male", region: "GB" },
    { id: "bm_fable", label: "Fable", gender: "male", region: "GB" },
    { id: "bm_george", label: "George", gender: "male", region: "GB" },
    { id: "bm_lewis", label: "Lewis", gender: "male", region: "GB" },
  ],
  es: [
    { id: "ef_dora", label: "Dora", gender: "female" },
    { id: "em_alex", label: "Alex", gender: "male" },
    { id: "em_santa", label: "Santa", gender: "male" },
  ],
  fr: [{ id: "ff_siwis", label: "Siwis", gender: "female" }],
  hi: [
    { id: "hf_alpha", label: "Alpha", gender: "female" },
    { id: "hf_beta", label: "Beta", gender: "female" },
    { id: "hm_omega", label: "Omega", gender: "male" },
    { id: "hm_psi", label: "Psi", gender: "male" },
  ],
  it: [
    { id: "if_sara", label: "Sara", gender: "female" },
    { id: "im_nicola", label: "Nicola", gender: "male" },
  ],
  ja: [
    { id: "jf_alpha", label: "Alpha", gender: "female" },
    { id: "jf_gongitsune", label: "Gongitsune", gender: "female" },
    { id: "jf_nezumi", label: "Nezumi", gender: "female" },
    { id: "jf_tebukuro", label: "Tebukuro", gender: "female" },
    { id: "jm_kumo", label: "Kumo", gender: "male" },
  ],
  pt: [
    { id: "pf_dora", label: "Dora", gender: "female" },
    { id: "pm_alex", label: "Alex", gender: "male" },
    { id: "pm_santa", label: "Santa", gender: "male" },
  ],
  zh: [
    { id: "zf_xiaobei", label: "Xiaobei", gender: "female" },
    { id: "zf_xiaoni", label: "Xiaoni", gender: "female" },
    { id: "zf_xiaoxiao", label: "Xiaoxiao", gender: "female" },
    { id: "zf_xiaoyi", label: "Xiaoyi", gender: "female" },
    { id: "zm_yunjian", label: "Yunjian", gender: "male" },
    { id: "zm_yunxi", label: "Yunxi", gender: "male" },
    { id: "zm_yunxia", label: "Yunxia", gender: "male" },
    { id: "zm_yunyang", label: "Yunyang", gender: "male" },
  ],
};
