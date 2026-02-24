import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileText } from "lucide-react";

export interface Source {
  title: string;
  url: string;
}

export interface RelevantDocument {
  title: string;
  url: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  jurisdiction?: string;
  sources?: Source[];
  relevantDocuments?: RelevantDocument[];
}

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div className="max-w-[75%] space-y-2">
        <div className={`flex items-center gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
          <span className="text-xs font-medium text-muted-foreground">
            {isUser ? "You" : "Assistant"}
          </span>
          {message.jurisdiction && (
            <span className="inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {message.jurisdiction}
            </span>
          )}
        </div>

        <div
          className={`rounded-xl px-4 py-3 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-card shadow-sm"
          }`}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="text-sm leading-relaxed text-card-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                  ol: ({ children }) => (
                    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
                  ),
                  li: ({ children }) => <li>{children}</li>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      {children}
                    </a>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes("language-");
                    return isBlock ? (
                      <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                        <code>{children}</code>
                      </pre>
                    ) : (
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {children}
                      </code>
                    );
                  },
                  table: ({ children }) => (
                    <div className="my-2 overflow-x-auto rounded-md border border-border">
                      <table className="w-full border-collapse text-xs">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border-b border-border bg-muted px-3 py-2 text-left text-xs font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border-b border-border px-3 py-2 text-xs">{children}</td>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {!isUser && (
          <div className="space-y-2 pl-1">
            {message.sources && message.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {message.sources.map((source, index) => (
                  <a
                    key={`${source.url}-${index}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <FileText className="h-3 w-3" />
                    <span className="font-medium">[{index + 1}]</span>
                    <span className="max-w-[180px] truncate">{source.title}</span>
                    <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                  </a>
                ))}
              </div>
            )}

            {message.relevantDocuments && message.relevantDocuments.length > 0 && (
              <div className="rounded-md border border-border bg-card/60 p-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Relevant docs
                </p>
                <div className="space-y-1">
                  {message.relevantDocuments.map((document, index) => (
                    <a
                      key={`${document.url}-${index}`}
                      href={document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <span className="font-medium">{index + 1}.</span>
                      <span className="truncate">{document.title}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
