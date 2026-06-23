export interface SupertonicVoice {
  id: string;
  label: string;
  gender: "female" | "male";
}

export const SUPERTONIC_VOICES: SupertonicVoice[] = [
  { id: "M1", label: "Male 1", gender: "male" },
  { id: "M2", label: "Male 2", gender: "male" },
  { id: "M3", label: "Male 3", gender: "male" },
  { id: "M4", label: "Male 4", gender: "male" },
  { id: "M5", label: "Male 5", gender: "male" },
  { id: "F1", label: "Female 1", gender: "female" },
  { id: "F2", label: "Female 2", gender: "female" },
  { id: "F3", label: "Female 3", gender: "female" },
  { id: "F4", label: "Female 4", gender: "female" },
  { id: "F5", label: "Female 5", gender: "female" },
];
