# ComplyAI - Regulatory Compliance Chatbot

Turning complex regulatory red tapes to simple conversations.

**ComplyAI** is a solution developed during Southern Manitoba Technology Conference's 6-hour Hackathon for Challenge 3: Regulatory Compliance Chatbot.

## Problem Statement

Do you ever read the Terms and Services of the applications you use? Reading through pages and pages of rules and regulations is considerably lame compared to getting your software up and running.

However, that is not a luxury businesses can afford. According to CFIB's [Canada's Red Tape Report](https://www.cfib-fcei.ca/en/research-economic-analysis/canadas-red-tape-report) in 2024, businesses of all sizes spent **768 million dollars** on regulatory compliance alone. That is the equivalent of nearly **394,000 full-time jobs**, just being spent scouring through provincial and federal regulations: invaluable human costs that should instead be spent on innovation, on growth, on creating value for your employees, your customers, and the entire industry.

Regulations are heavily text-based, highly specific, and constantly updated across disparate government websites, like the Continuing Consolidation of the Statutes of Manitoba, or C.C.S.M. Furthermore, regulations are never static; new laws and penalties are being introduced some unknown time in the future from now via the Accessibility for Manitobans Act. Manufacturers seek a solution with the ability to stay updated with and summarize all this abundant information, yet current solutions like ChatGPT are still prone to hallucinations and being unable to cite their sources; that which is most unacceptable when dealing with law enforcement.

Seeing this, we built **ComplyAI** - a chatbot that actually knows what it's talking about, to accompany your manufacturing team in turning complex regulatory red tapes to simple conversations.

## Tech Stack

- **Frontend**: React + Tailwind
- **Backend**: Flask
- **LLM Provider**: OpenAI
- **Vector Database**: Qdrant
- **OCR**: LlamaIndex

## Architecture

1. The user uploads the documents that the chatbot will source from. Else, the chatbot is equipped with pre-downloaded regulatory documents relevant to the Manitoban industry, which can be viewed, updated, or deleted from its knowledge base.
1. Text is extracted from the regulatory documents, broken up into chunks, and embedded into the vector database. Each chunk of text has metadata linking back to which document it came from.
1. When the user send a query, the query is embedded and compared against the vector database. Queries can be a simple question, a request to be guided through the application process for some permit, or the user can also upload a document such as their business plan and ask if it's compliant with all the regulations.
1. A RAG pipeline will be run, and the most relevant information chunks from the documents will be matched with the query. Information chunks must be above some certain "relevancy" thresholds.
1. The LLM will answer the user's inquiry, citing text chunks and explicitly linking which documents they got the information from. The LLM will also scores itself based on a function of the total relevancy of the information chunks it used in its response; if the score is below a certain threshold, it will not give an answer to the user's inquiry.
1. Users can create new chat sessions, revisit old ones, and delete old sessions.
1. (Not implemented) Authentication.
1. (Not implemented) To make sure the regulatory documents are up to date, a daily scraper connected to official provincial/federal regulators will detect if new documents are being put out, and whether they'd replace any old ones. If there is, the next time the user logs in, an alert will be created on whether they'd like to update the knowledge base with this new information; the documents are then inserted into or deleted from the vector database.

## Team Members

- Alexandr Yermakov
- Ethan Henry
- Maksym Lan
- McCauley Armishaw
- Peter Vu

## Original Problem Description

**Problem**: Navigating complex provincial/federal regulations is time-consuming and confusing

**Hackathon Challenge**: Build an AI Assistant that:
* Answers common regulatory questions for manufacturers
* Guides users through permit application processes step-by-step
* Identifies which regulations apply to specific operations
* Provides checklists for compliance requirements
* Links to relevant government resources and forms

**Tech Stack**: LLM integration (Claude API, OpenAI), RAG with regulatory documents