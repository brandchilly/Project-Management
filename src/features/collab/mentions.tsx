// Shared by task comments, client threads and chat.

// Rough check for credentials typed into chat; the vault is the right place for them.
export const SECRET_HINT = /\b(password|passwd|pwd|otp|pin)\b\s*[:=-]?\s*\S+/i;

// Shows @Name mentions in gold.
export function highlightMentions(text: string) {
  const parts = text.split(/(@[A-Za-z][\w.'-]*(?: [A-Z][\w.'-]*)?)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-medium text-gold-300">
        {part}
      </span>
    ) : (
      part
    )
  );
}
