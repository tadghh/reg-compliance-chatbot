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

type PersistedChatState = {
  conversations: Conversation[];
  activeConvId: string;
  inputValue: string;
};

const DEMO_QUESTIONS = [
  { text: "Who is eligible for a Design Canada Scholarship and what is it for?" },
  {
    text: "What types of innovation projects can receive a contribution (new/improved product, process, pollution abatement, industrial design, etc.)?",
  },
  {
    text: "What are the maximum contribution percentages for innovation projects in Tier Groups I, II, III, and IV?",
  },
  {
    text: "Is there a minimum eligible cost threshold for innovation contributions after February 18, 1987?",
  },
  {
    text: "Can I get assistance for a feasibility study or market research under the Innovation part? What percentage?",
  },
  {
    text: "Can buying an existing facility that has ceased production count as \"establishing a new facility\"?",
  },
  {
    text: "What are the maximum contribution rates and minimum capital cost thresholds for establishing a new facility in each Tier Group (I-IV)?",
  },
  {
    text: "Can I get consultant funding (feasibility study, market research, venture capital search) for a new facility project? At what rate?",
  },
  {
    text: "What kinds of modernization/expansion projects qualify (especially microelectronics, productivity improvements, etc.)?",
  },
  {
    text: "What contribution percentages apply to modernization projects in Tier Group I vs. Tier Group IV?",
  },
  {
    text: "Can relocating facilities qualify for assistance, and under which section?",
  },
  {
    text: "What marketing activities are eligible (catalogues, advertising, trade shows, market research, etc.) and what is the maximum contribution rate?",
  },
  { text: "Can a municipal corporation receive marketing assistance?" },
  {
    text: "If I signed a contract or made a purchase before submitting my application, can I still get assistance for those costs?",
  },
  {
    text: "What key information must every applicant provide about jobs, private investment leverage, unemployment in the district, pollution, etc.?",
  },
  {
    text: "When does the Minister have to consult the Canada Employment and Immigration Commission before approving assistance?",
  },
  {
    text: "If my project is in a Tier Group I district with high unemployment, can I still get new-facility or modernization assistance, and under what extra conditions?",
  },
];

const JURISDICTIONS: { value: Jurisdiction; label: string }[] = [
  { value: "federal", label: "Federal" },
  { value: "province", label: "Manitoba (Province)" },
];

let nextId = 2;
const CHAT_STATE_STORAGE_KEY = "regubot-chat-state-v1";
const DEFAULT_CONVERSATION: Conversation = {
  id: "1",
  name: "Conversation 1",
  messages: [],
  jurisdiction: "federal",
};

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

function parseRelevantDocument(rawDoc: unknown): { title: string; url: string } | null {
  if (typeof rawDoc !== "object" || rawDoc === null) {
    return null;
  }

  const candidate = rawDoc as Record<string, unknown>;
  const title =
    typeof candidate.title === "string"
      ? candidate.title
      : typeof candidate.name === "string"
        ? candidate.name
        : null;
  const url =
    typeof candidate.url === "string"
      ? candidate.url
      : typeof candidate.uri === "string"
        ? candidate.uri
        : null;

  if (!title || !url) {
    return null;
  }
  return { title, url };
}

function getNextConversationId(conversations: Conversation[]): number {
  const maxId = conversations.reduce((max, conversation) => {
    const parsed = Number.parseInt(conversation.id, 10);
    if (Number.isNaN(parsed)) {
      return max;
    }
    return Math.max(max, parsed);
  }, 0);
  return maxId + 1;
}

function loadPersistedState(): PersistedChatState {
  try {
    const raw = localStorage.getItem(CHAT_STATE_STORAGE_KEY);
    if (!raw) {
      return {
        conversations: [DEFAULT_CONVERSATION],
        activeConvId: DEFAULT_CONVERSATION.id,
        inputValue: "",
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedChatState>;
    const persistedConversations = Array.isArray(parsed.conversations)
      ? parsed.conversations
      : [];

    const conversations =
      persistedConversations.length > 0 ? persistedConversations : [DEFAULT_CONVERSATION];
    const activeConvId =
      typeof parsed.activeConvId === "string" &&
      conversations.some((conversation) => conversation.id === parsed.activeConvId)
        ? parsed.activeConvId
        : conversations[0].id;
    const inputValue = typeof parsed.inputValue === "string" ? parsed.inputValue : "";

    nextId = Math.max(nextId, getNextConversationId(conversations));
    return { conversations, activeConvId, inputValue };
  } catch {
    return {
      conversations: [DEFAULT_CONVERSATION],
      activeConvId: DEFAULT_CONVERSATION.id,
      inputValue: "",
    };
  }
}

function truncateTitle(title: string, maxLength = 48): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const slice = trimmed.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 8 ? slice.slice(0, lastSpace) : slice;

  return `${base}…`;
}

const ChatPage = () => {
  const initialStateRef = useRef<PersistedChatState | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = loadPersistedState();
  }
  const initialState = initialStateRef.current!;

  const [conversations, setConversations] = useState<Conversation[]>(initialState.conversations);
  const [activeConvId, setActiveConvId] = useState(initialState.activeConvId);
  const [inputValue, setInputValue] = useState(initialState.inputValue);
  const [isLoading, setIsLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConv?.messages.length, scrollToBottom]);

  useEffect(() => {
    if (!conversations.length) return;

    const stateToPersist: PersistedChatState = {
      conversations,
      activeConvId: conversations.some((conversation) => conversation.id === activeConvId)
        ? activeConvId
        : conversations[0].id,
      inputValue,
    };

    try {
      localStorage.setItem(CHAT_STATE_STORAGE_KEY, JSON.stringify(stateToPersist));
    } catch {
      // Ignore persistence errors (e.g., storage quota, disabled cookies)
    }
  }, [conversations, activeConvId, inputValue]);

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
    if (!activeConv) return;

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
        relevantDocuments: (response.relevant_documents ?? [])
          .map((document) => parseRelevantDocument(document))
          .filter((document): document is { title: string; url: string } => document !== null),
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
              value={activeConv?.jurisdiction ?? "federal"}
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
              {!activeConv || activeConv.messages.length === 0 ? (
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
