import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../memory/sqlite";

export interface Profile { budget?: number; diet: "any" | "vegetarian" | "vegan"; allergies: string[]; dislikes: string[]; addressId?: string; addressLabel?: string }
export interface ChatState { dishes: string[]; budget?: number; quantity: number; diet: Profile["diet"]; allergies: string[]; dislikes: string[]; premium: boolean; faster: boolean; restaurants: string[] }
export interface ChatMessage { id: string; role: "user" | "assistant"; text: string; cards?: unknown[]; suggestions?: string[] }
const emptyProfile: Profile = { diet: "any", allergies: [], dislikes: [] };
db.exec(`
 CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, profile TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS chats_owner ON chats(owner, updated);
 CREATE TABLE IF NOT EXISTS chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL, payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS messages_chat ON chat_messages(chat, seq);
`);
export function session(existing?: string): string {
  if (existing && db.prepare("SELECT id FROM chat_sessions WHERE id=?").get(existing)) return existing;
  const id = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO chat_sessions VALUES (?, ?)").run(id, JSON.stringify(emptyProfile));
  return id;
}
export function profile(owner: string): Profile {
  return JSON.parse((db.prepare("SELECT profile FROM chat_sessions WHERE id=?").get(owner) as { profile: string }).profile);
}
export function saveProfile(owner: string, value: Profile): void {
  db.prepare("UPDATE chat_sessions SET profile=? WHERE id=?").run(JSON.stringify(value), owner);
}
export function listChats(owner: string) {
  return db.prepare("SELECT id, title, updated FROM chats WHERE owner=? ORDER BY updated DESC").all(owner);
}
export function createChat(owner: string) {
  const id = randomUUID();
  const p = profile(owner);
  const state: ChatState = { dishes: [], budget: p.budget, quantity: 1, diet: p.diet, allergies: p.allergies, dislikes: p.dislikes, premium: false, faster: false, restaurants: [] };
  db.prepare("INSERT INTO chats VALUES (?, ?, ?, ?, ?)").run(id, owner, "New craving", JSON.stringify(state), Date.now());
  return getChat(owner, id)!;
}
export function getChat(owner: string, id: string) {
  const row = db.prepare("SELECT id, title, state FROM chats WHERE owner=? AND id=?").get(owner, id) as { id: string; title: string; state: string } | undefined;
  if (!row) return undefined;
  const messages = db.prepare("SELECT payload FROM chat_messages WHERE chat=? ORDER BY seq").all(id) as { payload: string }[];
  return { id: row.id, title: row.title, state: JSON.parse(row.state) as ChatState, messages: messages.map(m => JSON.parse(m.payload) as ChatMessage) };
}
export function appendMessage(owner: string, id: string, message: ChatMessage, state?: ChatState): void {
  db.transaction(() => {
    if (!getChat(owner, id)) throw new Error("Chat not found.");
    db.prepare("INSERT INTO chat_messages(chat,payload) VALUES (?,?)").run(id, JSON.stringify(message));
    db.prepare("UPDATE chats SET updated=?, state=COALESCE(?,state), title=CASE WHEN title='New craving' AND ?='user' THEN ? ELSE title END WHERE id=? AND owner=?")
      .run(Date.now(), state ? JSON.stringify(state) : null, message.role, message.text.slice(0, 65), id, owner);
  })();
}
export function deleteChat(owner: string, id: string): void {
  db.transaction(() => {
    if (!getChat(owner, id)) return;
    db.prepare("DELETE FROM chat_messages WHERE chat=?").run(id);
    db.prepare("DELETE FROM chats WHERE owner=? AND id=?").run(owner, id);
  })();
}
