import AsyncStorage from '@react-native-async-storage/async-storage';
import seed from './data/names.json';

export type Person = { id: number; name: string };

export type SavedState = {
  people: Person[];
  selected: number[];
  title: string;
  date: string; // yyyy-mm-dd
};

// Same key as the web version so the data layout stays familiar.
const PEOPLE_KEY = 'examAttendanceNames_v1';
const SESSION_KEY = 'examAttendanceSession_v1';

export const SEED: Person[] = (seed as Person[]).map(p => ({ id: p.id, name: p.name }));

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Accepts the same shapes as the web app: ["name", ...] or [{id, name}, ...]. */
export function parsePeopleArray(data: unknown): Person[] {
  if (!Array.isArray(data)) throw new Error('The file does not contain a list of names.');
  const used = new Set<number>();
  return data.map((item, idx) => {
    let person: Person;
    if (typeof item === 'string') person = { id: idx + 1, name: item };
    else if (item && typeof item === 'object' && typeof (item as any).name === 'string') {
      const rawId = Number((item as any).id);
      person = { id: Number.isFinite(rawId) ? rawId : idx + 1, name: (item as any).name };
    } else throw new Error(`Item ${idx + 1} has no name.`);
    // keep ids unique so ticks never land on two people
    while (used.has(person.id)) person.id += 100000;
    used.add(person.id);
    person.name = person.name.trim();
    return person;
  }).filter(p => p.name.length > 0);
}

export async function loadState(): Promise<{ state: SavedState; fromStorage: boolean }> {
  let people = SEED, fromStorage = false;
  try {
    const raw = await AsyncStorage.getItem(PEOPLE_KEY);
    if (raw) { people = parsePeopleArray(JSON.parse(raw)); fromStorage = true; }
  } catch (e) {
    console.warn('Could not read saved names', e);
  }
  let session = { selected: [] as number[], title: '', date: todayISO() };
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) session = { ...session, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('Could not read saved session', e);
  }
  const ids = new Set(people.map(p => p.id));
  return { state: { people, selected: session.selected.filter(id => ids.has(id)), title: session.title, date: session.date || todayISO() }, fromStorage };
}

export async function savePeople(people: Person[]) {
  try { await AsyncStorage.setItem(PEOPLE_KEY, JSON.stringify(people)); } catch (e) { console.warn('Could not save names', e); }
}

export async function saveSession(s: { selected: number[]; title: string; date: string }) {
  try { await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { console.warn('Could not save session', e); }
}
