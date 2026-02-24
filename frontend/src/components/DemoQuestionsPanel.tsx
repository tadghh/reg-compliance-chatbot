import { useState } from "react";
import { Copy, Check, ArrowRight } from "lucide-react";

interface DemoQuestion {
  text: string;
}

interface DemoQuestionsPanelProps {
  questions: DemoQuestion[];
  onUse: (text: string) => void;
}

const DemoQuestionsPanel = ({ questions, onUse }: DemoQuestionsPanelProps) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="px-1">
        <h3 className="text-sm font-semibold text-foreground">Try these prompts</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Click to populate the input field</p>
      </div>
      <div className="space-y-2">
        {questions.map((question, index) => (
          <button
            key={index}
            onClick={() => onUse(question.text)}
            className="group w-full rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:shadow-sm"
          >
            <p className="line-clamp-2 text-sm leading-relaxed text-foreground/90">
              {question.text}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Use this <ArrowRight className="h-3 w-3" />
              </span>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handleCopy(question.text, index);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {copiedIndex === index ? (
                  <>
                    <Check className="h-3 w-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy
                  </>
                )}
              </button>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default DemoQuestionsPanel;
