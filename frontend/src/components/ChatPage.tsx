import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, X, Send, Loader2, Shield, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import DemoQuestionsPanel from "@/components/DemoQuestionsPanel";
import MessageBubble, { type ChatMessage } from "@/components/MessageBubble";
import { apiClient, type Jurisdiction } from "@/lib/api-client";

interface Conversation {
  id: string;
  name: string;
  messages: ChatMessage[];
  jurisdiction: Jurisdiction;
}

const DEMO_QUESTIONS = [
  { text: "What are the key requirements for anti-money laundering (AML) compliance in Canada?" },
  { text: "Explain the differences between federal and provincial privacy regulations." },
  { text: "What are the reporting obligations under FINTRAC for financial institutions?" },
  { text: "How does Manitoba's consumer protection legislation differ from federal standards?" },
  { text: "What are the penalties for non-compliance with environmental regulations in Manitoba?" },
];

const JURISDICTIONS: { value: Jurisdiction; label: string }[] = [
  { value: "federal", label: "Federal" },
  { value: "province", label: "Manitoba (Province)" },
];

let nextId = 2;

const STORAGE_KEY = "compliance-chatpage-conversations-v1";
const ACTIVE_CONVERSATION_KEY = "compliance-chatpage-active-conversation-v1";

function truncateTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 42) {
    return compact;
  }
  return `${compact.slice(0, 39)}...`;
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = record.role === "user" || record.role === "assistant" ? record.role : null;
  const content =
    typeof record.content === "string"
      ? record.content
      : typeof record.text === "string"
        ? record.text
        : null;

  if (!role || !content) {
    return null;
  }

  return {
    role,
    content,
    jurisdiction: typeof record.jurisdiction === "string" ? record.jurisdiction : undefined,
    sources: Array.isArray(record.sources) ? (record.sources as any) : undefined,
  };
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [{ id: "1", name: "New conversation", messages: [], jurisdiction: "federal" }];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ id: "1", name: "New conversation", messages: [], jurisdiction: "federal" }];
    }

    const normalized = parsed.map((value: any, index: number): Conversation => {
      const messagesRaw = Array.isArray(value?.messages) ? value.messages : [];
      const messages = messagesRaw
        .map((message: unknown) => normalizeMessage(message))
        .filter((message): message is ChatMessage => message !== null);

      const fallbackNameFromMessages = (() => {
        const firstUser = messages.find((message) => message.role === "user");
        const base = firstUser?.content ?? messages[0]?.content ?? "";
        return base ? truncateTitle(base) : `Conversation ${index + 1}`;
      })();

      const nameCandidate =
        typeof value?.name === "string"
          ? value.name
          : typeof value?.title === "string"
            ? value.title
            : "";

      const name =
        nameCandidate.trim() && !nameCandidate.startsWith("Conversation ")
          ? nameCandidate.trim()
          : fallbackNameFromMessages;

      const jurisdiction =
        value?.jurisdiction === "federal" || value?.jurisdiction === "province"
          ? value.jurisdiction
          : "federal";

      return {
        id: typeof value?.id === "string" ? value.id : String(index + 1),
        name,
        messages,
        jurisdiction,
      };
    });

    const maxNumericId = normalized
      .map((conversation) => Number.parseInt(conversation.id, 10))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 1);
    nextId = Math.max(2, maxNumericId + 1);

    return normalized;
  } catch {
    return [{ id: "1", name: "New conversation", messages: [], jurisdiction: "federal" }];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore quota / private mode errors
  }
}

function buildFallbackSourceUrl(rawSource: string, jurisdiction: Jurisdiction): string {
  const query = encodeURIComponent(rawSource);
  if (jurisdiction === "federal") {
    return `https://laws-lois.justice.gc.ca/eng/search/search.aspx?txtS3archA11=${query}`;
  }
  return `https://www.gov.mb.ca/search/index.html?q=${query}`;
}

function parseSource(rawSource: unknown, jurisdiction: Jurisdiction) {
  if (typeof rawSource === "string") {
    const urlMatch = rawSource.match(/https?:\/\/[^\s)]+/i);
    const url = urlMatch?.[0] ?? buildFallbackSourceUrl(rawSource, jurisdiction);
    const title = rawSource.replace(url, "").trim() || rawSource;
    return { title, url };
  }

  if (typeof rawSource === "object" && rawSource !== null) {
    const maybe = rawSource as Record<string, unknown>;
    const url =
      typeof maybe.url === "string"
        ? maybe.url
        : typeof maybe.source_url === "string"
          ? maybe.source_url
          : null;
    const title =
      typeof maybe.title === "string"
        ? maybe.title
        : typeof maybe.name === "string"
          ? maybe.name
          : "Source";

    if (!url) {
      return {
        title,
        url: buildFallbackSourceUrl(title, jurisdiction),
      };
    }
    return { title, url };
  }

  return null;
}

const ChatPage = () => {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeConvId, setActiveConvId] = useState(() => {
    const initial = loadConversations();
    const saved = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    return saved && initial.some((conversation) => conversation.id === saved)
      ? saved
      : initial[0]?.id ?? "1";
  });
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? conversations[0];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConv?.messages.length, scrollToBottom]);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConvId);
    } catch {}
  }, [activeConvId]);

  const addConversation = () => {
    const id = String(nextId++);
    const newConv: Conversation = {
      id,
      name: "New conversation",
      messages: [],
      jurisdiction: "federal",
    };
    setConversations((prev) => [...prev, newConv]);
    setActiveConvId(id);
  };

  const deleteConversation = (id: string) => {
    if (conversations.length <= 1) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveConvId(remaining[0].id);
    }
  };

  const setJurisdiction = (value: Jurisdiction) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, jurisdiction: value } : c)),
    );
  };

  const sendMessage = async (text?: string) => {
    const content = text || inputValue.trim();
    if (!content || isLoading) return;

    if (!activeConv) return;

    const jurisdictionLabel = activeConv.jurisdiction === "province" ? "Manitoba" : "Federal";
    const userMessage: ChatMessage = {
      role: "user",
      content,
      jurisdiction: jurisdictionLabel,
      sources: [],
    };

    const historyPayload = [...activeConv.messages, userMessage]
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvId
          ? {
              ...c,
              name:
                c.messages.length === 0 && (c.name === "New conversation" || c.name.startsWith("Conversation "))
                  ? truncateTitle(content)
                  : c.name,
              messages: [...c.messages, userMessage],
            }
          : c,
      ),
    );
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await apiClient.query({
        query: content,
        top_k: 8,
        jurisdiction: activeConv.jurisdiction,
        messages: historyPayload,
      });

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.answer?.trim() || "No answer returned.",
        jurisdiction: jurisdictionLabel,
        sources: (response.sources ?? [])
          .map((source) => parseSource(source, activeConv.jurisdiction))
          .filter((source): source is { title: string; url: string } => source !== null),
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId ? { ...c, messages: [...c.messages, assistantMessage] } : c,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: `Unable to fetch response from backend: ${message}`,
        jurisdiction: jurisdictionLabel,
        sources: [],
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId ? { ...c, messages: [...c.messages, assistantMessage] } : c,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const handleDemoUse = (text: string) => {
    setInputValue(text);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-accent-teal to-primary" />

      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Regulatory Compliance
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={activeConv.jurisdiction}
              onChange={(event) => setJurisdiction(event.target.value as Jurisdiction)}
              className="appearance-none rounded-md border border-border bg-card py-1.5 pl-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {JURISDICTIONS.map((jurisdiction) => (
                <option key={jurisdiction.value} value={jurisdiction.value}>
                  {jurisdiction.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
            {conversations.map((conversation) => (
              <div key={conversation.id} className="flex shrink-0 items-center">
                <button
                  onClick={() => setActiveConvId(conversation.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    conversation.id === activeConvId
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {conversation.name}
                </button>
                {conversations.length > 1 && (
                  <button
                    onClick={() => deleteConversation(conversation.id)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={addConversation}
              className="h-7 shrink-0 text-muted-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
            <div className="mx-auto max-w-3xl space-y-5">
              {activeConv.messages.length === 0 ? (
                <div className="flex h-full items-center justify-center py-20">
                  <div className="space-y-3 text-center">
                    <Shield className="mx-auto h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      Ask a question about regulatory compliance to get started.
                    </p>
                    <button
                      onClick={() => setShowSidebar(true)}
                      className="text-xs text-primary hover:underline lg:hidden"
                    >
                      View demo questions →
                    </button>
                  </div>
                </div>
              ) : (
                activeConv.messages.map((message, index) => (
                  <MessageBubble key={index} message={message} />
                ))
              )}

              {isLoading && (
                <div className="flex animate-pulse-soft items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Generating response…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="border-t border-border bg-card/50">
            <div className="mx-auto max-w-3xl px-4 py-3 lg:px-8">
              <div className="flex gap-2">
                <textarea
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about regulatory compliance..."
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <Button
                  onClick={() => sendMessage()}
                  disabled={!inputValue.trim() || isLoading}
                  size="icon"
                  className="h-10 w-10 shrink-0 self-end"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
                Not legal advice. Always verify with qualified counsel.
              </p>
            </div>
          </div>
        </div>

        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border p-5 lg:block">
          <DemoQuestionsPanel questions={DEMO_QUESTIONS} onUse={handleDemoUse} />
        </aside>
      </div>

      {showSidebar && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setShowSidebar(false)}
          />
          <div className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Demo Questions</h3>
              <button onClick={() => setShowSidebar(false)} className="rounded p-1 hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <DemoQuestionsPanel
              questions={DEMO_QUESTIONS}
              onUse={(text) => {
                handleDemoUse(text);
                setShowSidebar(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatPage;
