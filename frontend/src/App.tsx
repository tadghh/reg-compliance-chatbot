import { FormEvent, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, Send } from "lucide-react";

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

type Jurisdiction = "federal" | "province";

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

type QueryResponse = {
  answer?: string;
  sources?: unknown[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const demoQuestions = [
  "What federal permits are needed to transport hazardous waste across provinces?",
  "List a startup checklist for opening a food processing facility in Ontario.",
  "What records must employers keep for occupational health and safety compliance?",
  "Explain the top 5 privacy obligations under federal PIPEDA for small businesses.",
  "What are anti-money laundering reporting triggers for Canadian fintech platforms?",
  "What environmental reporting obligations apply to manufacturing wastewater discharge?",
  "Summarize worker classification compliance risks for contractors vs employees.",
  "What labeling requirements apply to imported packaged foods sold in Canada?",
  "How should a company prepare for a provincial labor inspection?",
  "Provide a compliance roadmap for launching a telehealth service in Canada.",
];

function buildFallbackSourceUrl(rawSource: string, jurisdiction: Jurisdiction): string {
  const query = encodeURIComponent(rawSource);
  if (jurisdiction === "federal") {
    return `https://laws-lois.justice.gc.ca/eng/search/search.aspx?txtS3archA11=${query}`;
  }
  return `https://www.ontario.ca/search?search=${query}`;
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

function App() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("federal");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedQuestion, setCopiedQuestion] = useState<string | null>(null);

  const placeholder = useMemo(() => {
    return jurisdiction === "federal"
      ? "Ask a federal compliance question..."
      : "Ask a provincial compliance question...";
  }, [jurisdiction]);

  async function copyQuestion(question: string) {
    try {
      await navigator.clipboard.writeText(question);
      setCopiedQuestion(question);
      setTimeout(() => setCopiedQuestion(null), 1200);
    } catch {
      setCopiedQuestion(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || loading) {
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: userMessage,
        sources: [],
        jurisdiction,
      },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          top_k: 8,
          jurisdiction,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = (await response.json()) as QueryResponse;
      const parsedSources = (data.sources ?? [])
        .map((item) => parseSource(item, jurisdiction))
        .filter((item): item is Source => item !== null);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer?.trim() || "No answer returned.",
          sources: parsedSources,
          jurisdiction,
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Unable to fetch response from backend: ${message}`,
          sources: [],
          jurisdiction,
        },
      ]);
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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <CardTitle>Chat</CardTitle>
                <CardDescription>
                  Ask compliance questions and inspect source links under each answer.
                </CardDescription>
              </div>
              <div className="w-full sm:w-60">
                <Label htmlFor="jurisdiction">Jurisdiction</Label>
                <Select
                  id="jurisdiction"
                  value={jurisdiction}
                  onChange={(event) =>
                    setJurisdiction(event.target.value as Jurisdiction)
                  }
                >
                  <option value="federal">Federal</option>
                  <option value="province">Province</option>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No messages yet. Try one of the demo prompts.
                </div>
              )}
              {messages.map((message) => (
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
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
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
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={placeholder}
                disabled={loading}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={loading || input.trim().length === 0}>
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
                      onClick={() => setInput(question)}
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
