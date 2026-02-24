import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Loader2, Plus, Send, X } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, type Jurisdiction } from "@/lib/api-client";

type Source = {
  title: string;
  url: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources: Source[];
  jurisdiction?: Jurisdiction;
};

type Conversation = {
  id: string;
  title: string;
  jurisdiction: Jurisdiction;
  input: string;
  messages: ChatMessage[];
};

const demoQuestions = [
  "What federal and Manitoba permits are typically required to start a metal fabrication plant in Manitoba?",
  "Create a Manitoba-focused compliance checklist for WHMIS training, SDS management, and hazardous product labeling in a manufacturing facility.",
  "What records must a manufacturer keep to satisfy Manitoba workplace safety inspection requirements?",
  "What Manitoba environmental approvals and reporting are required for air emissions and wastewater discharge from a manufacturing site?",
  "Summarize TDG requirements for shipping dangerous goods from a Manitoba manufacturing facility to another province.",
  "What are CEPA obligations for handling and reporting toxic substances used in a Manitoba manufacturing operation?",
  "What machine guarding and lockout-tagout controls should be documented for a Manitoba provincial safety audit?",
  "List key compliance steps for importing raw materials into Manitoba and meeting federal plus provincial labeling requirements.",
  "How should a Manitoba manufacturer prepare for an unannounced provincial workplace inspection and what documents should be ready?",
  "Provide a 90-day regulatory compliance roadmap for launching a new food manufacturing line in Manitoba.",
];

function buildFallbackSourceUrl(rawSource: string, jurisdiction: Jurisdiction): string {
  const query = encodeURIComponent(rawSource);
  if (jurisdiction === "federal") {
    return `https://laws-lois.justice.gc.ca/eng/search/search.aspx?txtS3archA11=${query}`;
  }
  return `https://www.gov.mb.ca/search/index.html?q=${query}`;
}

function parseSource(rawSource: unknown, jurisdiction: Jurisdiction): Source | null {
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

function truncateTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 42) {
    return compact;
  }
  return `${compact.slice(0, 39)}...`;
}

function createConversation(number: number): Conversation {
  return {
    id: crypto.randomUUID(),
    title: `Conversation ${number}`,
    jurisdiction: "federal",
    input: "",
    messages: [],
  };
}

const initialConversation = createConversation(1);

const STORAGE_KEY = "compliance-chat-conversations-v1";

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [initialConversation];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [initialConversation];
    }

    return parsed.map((value: any, index: number): Conversation => {
      const messages = Array.isArray(value.messages) ? value.messages : [];

      let title: string;
      if (
        typeof value.title === "string" &&
        value.title.trim().length > 0 &&
        !value.title.startsWith("Conversation ")
      ) {
        title = value.title.trim();
      } else if (messages.length > 0) {
        const firstUserMessage = messages.find(
          (message: any) => message?.role === "user" && typeof message.text === "string",
        );
        const sourceText =
          (firstUserMessage?.text as string | undefined) ??
          (typeof messages[0].text === "string" ? messages[0].text : "");
        title = sourceText ? truncateTitle(sourceText) : `Conversation ${index + 1}`;
      } else {
        title = `Conversation ${index + 1}`;
      }

      return {
        id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
        title,
        jurisdiction:
          value.jurisdiction === "federal" || value.jurisdiction === "province"
            ? value.jurisdiction
            : "federal",
        input: typeof value.input === "string" ? value.input : "",
        messages,
      };
    });
  } catch {
    return [initialConversation];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore storage errors (e.g., private mode, quota)
  }
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="mb-1">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded bg-muted p-3 text-[0.85em] last:mb-0">
      {children as ReactNode}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded border last:mb-0">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b bg-muted px-3 py-2 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b px-3 py-2 align-top">{children}</td>
  ),
};

function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadConversations(),
  );
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const initial = loadConversations();
    return initial[0]?.id ?? initialConversation.id;
  });
  const [nextConversationNumber, setNextConversationNumber] = useState<number>(() => {
    const initial = loadConversations();
    return initial.length + 1;
  });
  const [loading, setLoading] = useState(false);
  const [copiedQuestion, setCopiedQuestion] = useState<string | null>(null);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  const activeConversation = useMemo(() => {
    return (
      conversations.find((conversation) => conversation.id === activeConversationId) ??
      conversations[0]
    );
  }, [activeConversationId, conversations]);

  const activeJurisdiction = activeConversation?.jurisdiction ?? "federal";
  const activeInput = activeConversation?.input ?? "";
  const activeMessages = activeConversation?.messages ?? [];

  const placeholder = useMemo(() => {
    return activeJurisdiction === "federal"
      ? "Ask a federal compliance question..."
      : "Ask a Manitoba compliance question...";
  }, [activeJurisdiction]);

  async function copyQuestion(question: string) {
    try {
      await navigator.clipboard.writeText(question);
      setCopiedQuestion(question);
      setTimeout(() => setCopiedQuestion(null), 1200);
    } catch {
      setCopiedQuestion(null);
    }
  }

  function updateConversation(
    conversationId: string,
    updater: (conversation: Conversation) => Conversation,
  ) {
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === conversationId ? updater(conversation) : conversation,
      ),
    );
  }

  function handleCreateConversation() {
    if (loading) {
      return;
    }
    const conversation = createConversation(nextConversationNumber);
    setConversations((previous) => [conversation, ...previous]);
    setActiveConversationId(conversation.id);
    setNextConversationNumber((previous) => previous + 1);
  }

  function handleDeleteConversation(conversationId: string) {
    if (loading || conversations.length === 1) {
      return;
    }

    setConversations((previous) =>
      previous.filter((conversation) => conversation.id !== conversationId),
    );

    if (activeConversationId === conversationId) {
      const nextConversation = conversations.find(
        (conversation) => conversation.id !== conversationId,
      );
      if (nextConversation) {
        setActiveConversationId(nextConversation.id);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConversation) {
      return;
    }

    const conversationId = activeConversation.id;
    const jurisdiction = activeConversation.jurisdiction;
    const userMessage = activeConversation.input.trim();
    if (!userMessage || loading) {
      return;
    }

    const userMessageEntry: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: userMessage,
      sources: [],
      jurisdiction,
    };

    const historyPayload = [...activeConversation.messages, userMessageEntry]
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.text,
      }));
    const updatedTitle =
      activeConversation.messages.length === 0
        ? truncateTitle(userMessage)
        : activeConversation.title;

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: updatedTitle,
      input: "",
      messages: [...conversation.messages, userMessageEntry],
    }));
    setLoading(true);

    try {
      const data = await apiClient.query({
        query: userMessage,
        top_k: 8,
        jurisdiction,
        messages: historyPayload,
      });
      const parsedSources = (data.sources ?? [])
        .map((item) => parseSource(item, jurisdiction))
        .filter((item): item is Source => item !== null);

      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: data.answer?.trim() || "No answer returned.",
            sources: parsedSources,
            jurisdiction,
          },
        ],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `Unable to fetch response from backend: ${message}`,
            sources: [],
            jurisdiction,
          },
        ],
      }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Regulatory Compliance Chatbot
        </h1>
        <p className="text-sm text-muted-foreground md:text-base">
          Prototype assistant with citations and jurisdiction filtering.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="h-fit">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <CardTitle>Chat</CardTitle>
                <CardDescription>
                  Ask compliance questions and inspect source links under each answer.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={handleCreateConversation}
                disabled={loading}
              >
                <Plus className="mr-2 h-4 w-4" />
                New conversation
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={
                    conversation.id === activeConversation?.id
                      ? "flex max-w-[280px] items-center gap-1 rounded-md border border-transparent bg-primary px-2 text-primary-foreground"
                      : "flex max-w-[280px] items-center gap-1 rounded-md border bg-background px-2"
                  }
                >
                  <button
                    type="button"
                    className="truncate py-1.5 text-sm"
                    onClick={() => setActiveConversationId(conversation.id)}
                  >
                    {conversation.title}
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 transition-colors hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => handleDeleteConversation(conversation.id)}
                    disabled={loading || conversations.length === 1}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="w-full sm:w-60">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Select
                id="jurisdiction"
                value={activeJurisdiction}
                onChange={(event) =>
                  activeConversation &&
                  updateConversation(activeConversation.id, (conversation) => ({
                    ...conversation,
                    jurisdiction: event.target.value as Jurisdiction,
                  }))
                }
                disabled={loading}
              >
                <option value="federal">Federal</option>
                <option value="province">Manitoba (Province)</option>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
              {activeMessages.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No messages yet. Try one of the demo prompts.
                </div>
              )}
              {activeMessages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto w-full max-w-[90%] rounded-lg bg-secondary p-4"
                      : "mr-auto w-full max-w-[90%] rounded-lg border bg-card p-4"
                  }
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant={message.role === "user" ? "secondary" : "outline"}>
                      {message.role === "user" ? "You" : "Assistant"}
                    </Badge>
                    {message.jurisdiction && (
                      <Badge variant="outline">{message.jurisdiction}</Badge>
                    )}
                  </div>
                  {message.role === "assistant" ? (
                    <div className="text-sm leading-6">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {message.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
                  )}
                  {message.role === "assistant" && (
                    <>
                      <Separator className="my-3" />
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sources
                      </h3>
                      {message.sources.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No sources provided.</p>
                      ) : (
                        <ol className="space-y-2 text-sm">
                          {message.sources.map((source, index) => (
                            <li key={`${message.id}-source-${index}`}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <span className="font-medium">[{index + 1}]</span>
                                <span>{source.title}</span>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </li>
                          ))}
                        </ol>
                      )}
                    </>
                  )}
                </article>
              ))}
              {loading && (
                <div className="flex w-fit items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating response...
                </div>
              )}
            </div>

            <Separator />

            <form className="space-y-3" onSubmit={handleSubmit}>
              <Label htmlFor="question">Message</Label>
              <Textarea
                id="question"
                value={activeInput}
                onChange={(event) =>
                  activeConversation &&
                  updateConversation(activeConversation.id, (conversation) => ({
                    ...conversation,
                    input: event.target.value,
                  }))
                }
                placeholder={placeholder}
                disabled={loading}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={loading || activeInput.trim().length === 0}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demo Questions</CardTitle>
            <CardDescription>Paste quickly during a live demo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {demoQuestions.map((question) => {
              const copied = copiedQuestion === question;
              return (
                <div
                  key={question}
                  className="rounded-md border bg-background p-3 text-sm leading-5"
                >
                  <p>{question}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        activeConversation &&
                        updateConversation(activeConversation.id, (conversation) => ({
                          ...conversation,
                          input: question,
                        }))
                      }
                      disabled={loading}
                    >
                      Use
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyQuestion(question)}
                      disabled={loading}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default App;
