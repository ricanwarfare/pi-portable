import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import pLimit from "p-limit";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "web-search.json");
let cachedConfig = null;
const loadConfig = () => {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}
	try {
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		cachedConfig = {
			exaApiKey: normalizeKey(parsed.exaApiKey),
			braveApiKey: normalizeKey(parsed.braveApiKey),
			provider: normalizeProvider(parsed.provider ?? parsed.searchProvider ?? "auto")
		};
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`, { cause: err });
	}
};
const normalizeKey = (value) => {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
};
const normalizeProvider = (value) => {
	if (typeof value !== "string") return "auto";
	const normalized = value.trim().toLowerCase();
	if (normalized === "exa") return "exa";
	if (normalized === "brave") return "brave";
	return "auto";
};
const errorMessage = (err) => {
	return err instanceof Error ? err.message : String(err);
};
const freshnessFromRecency = (filter) => {
	if (!filter) return void 0;
	return {
		day: "pd",
		week: "pw",
		month: "pm",
		year: "py"
	}[filter];
};
const getApiKey = (keyName) => {
	const envVar = keyName === "exaApiKey" ? "EXA_API_KEY" : "BRAVE_API_KEY";
	return process.env[envVar] ?? loadConfig()[keyName];
};
const getExaApiKey = () => {
	return getApiKey("exaApiKey");
};
const getBraveApiKey = () => {
	return getApiKey("braveApiKey");
};
//#endregion
//#region search.ts
const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_USAGE_PATH = join(homedir(), ".pi", "exa-usage.json");
const MONTHLY_LIMIT = 1e3;
const MCP_TIMEOUT_MS = 6e4;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const getCurrentMonth = () => {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
};
const readExaUsage = () => {
	if (!existsSync(EXA_USAGE_PATH)) return {
		month: getCurrentMonth(),
		count: 0
	};
	try {
		const raw = JSON.parse(readFileSync(EXA_USAGE_PATH, "utf-8"));
		const month = typeof raw.month === "string" ? raw.month : getCurrentMonth();
		const count = typeof raw.count === "number" && Number.isFinite(raw.count) ? Math.max(0, Math.floor(raw.count)) : 0;
		if (month !== getCurrentMonth()) return {
			month: getCurrentMonth(),
			count: 0
		};
		return {
			month,
			count
		};
	} catch {
		return {
			month: getCurrentMonth(),
			count: 0
		};
	}
};
const writeExaUsage = (usage) => {
	const dir = join(homedir(), ".pi");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(EXA_USAGE_PATH, JSON.stringify(usage, null, 2) + "\n");
};
const reserveExaBudget = () => {
	const usage = readExaUsage();
	if (usage.count >= MONTHLY_LIMIT) return { exhausted: true };
	writeExaUsage({
		month: usage.month,
		count: usage.count + 1
	});
	return null;
};
const callExaMcp = async (toolName, args, signal) => {
	const timeout = AbortSignal.timeout(MCP_TIMEOUT_MS);
	const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const response = await fetch(EXA_MCP_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream"
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: toolName,
				arguments: args
			}
		}),
		signal: combinedSignal
	});
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Exa MCP error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	const body = await response.text();
	const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
	let parsed = null;
	for (const line of dataLines) {
		const payload = line.slice(5).trim();
		if (!payload) continue;
		try {
			const candidate = JSON.parse(payload);
			if (candidate?.result || candidate?.error) {
				parsed = candidate;
				break;
			}
		} catch {}
	}
	if (!parsed) try {
		const candidate = JSON.parse(body);
		if (candidate?.result || candidate?.error) parsed = candidate;
	} catch {}
	if (!parsed) throw new Error("Exa MCP returned an empty response");
	if (parsed.error) {
		const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
		throw new Error(`Exa MCP error${code}: ${parsed.error.message ?? "Unknown error"}`);
	}
	if (parsed.result?.isError) {
		const message = parsed.result.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text?.trim();
		throw new Error(message || "Exa MCP returned an error");
	}
	const text = parsed.result?.content?.find((item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0)?.text;
	if (!text) throw new Error("Exa MCP returned empty content");
	return text;
};
const parseExaMcpResults = (text) => {
	const parsed = text.split(/(?=^Title: )/m).filter((block) => block.trim().length > 0).map((block) => {
		const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
		const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
		let content = "";
		const textStart = block.indexOf("\nText: ");
		if (textStart >= 0) content = block.slice(textStart + 7).trim();
		else {
			const hlMatch = block.match(/\nHighlights:\s*\n/);
			if (hlMatch?.index != null) content = block.slice(hlMatch.index + hlMatch[0].length).trim();
		}
		content = content.replace(/\n---\s*$/, "").trim();
		return {
			title,
			url,
			content
		};
	}).filter((r) => r.url.length > 0);
	return parsed.length > 0 ? parsed : null;
};
const buildAnswerFromMcpResults = (results) => {
	if (results.length === 0) return "";
	return results.map((r, i) => {
		const snippet = r.content.replace(/\s+/g, " ").trim().slice(0, 500);
		if (!snippet) return null;
		return `${snippet}\nSource: ${r.title || `Source ${i + 1}`} (${r.url})`;
	}).filter(Boolean).join("\n\n");
};
const mapMcpInlineContent = (results) => {
	return results.filter((r) => r.content.length > 0).map((r) => ({
		url: r.url,
		title: r.title,
		content: r.content,
		error: null
	}));
};
const buildExaMcpQuery = (query, options) => {
	const parts = [query];
	if (options.domainFilter?.length) for (const d of options.domainFilter) parts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
	if (options.recencyFilter) {
		const now = /* @__PURE__ */ new Date();
		switch (options.recencyFilter) {
			case "day":
				parts.push("past 24 hours");
				break;
			case "week":
				parts.push("past week");
				break;
			case "month":
				parts.push(`${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`);
				break;
			case "year":
				parts.push(String(now.getFullYear()));
				break;
		}
	}
	return parts.join(" ");
};
const searchWithExaMcp = async (query, options = {}) => {
	const parsedResults = parseExaMcpResults(await callExaMcp("web_search_exa", {
		query: buildExaMcpQuery(query, options),
		numResults: options.numResults ?? 5,
		livecrawl: "fallback",
		type: "auto",
		contextMaxCharacters: options.includeContent ? 5e4 : 3e3
	}, options.signal));
	if (!parsedResults) return null;
	const response = {
		answer: buildAnswerFromMcpResults(parsedResults),
		results: parsedResults.map((r, i) => ({
			title: r.title || `Source ${i + 1}`,
			url: r.url,
			snippet: ""
		}))
	};
	if (options.includeContent) {
		const inlineContent = mapMcpInlineContent(parsedResults);
		if (inlineContent.length > 0) response.inlineContent = inlineContent;
	}
	return response;
};
const mapExaResults = (results) => {
	if (!Array.isArray(results)) return [];
	const mapped = [];
	for (const item of results) {
		if (!item?.url) continue;
		mapped.push({
			title: item.title || `Source ${mapped.length + 1}`,
			url: item.url,
			snippet: ""
		});
	}
	return mapped;
};
const buildExaAnswerFromSearchResults = (results) => {
	if (!results?.length) return "";
	return results.map((item, i) => {
		if (!item?.url) return null;
		const highlights = Array.isArray(item.highlights) ? item.highlights.filter((h) => typeof h === "string" && h.trim().length > 0) : [];
		const content = highlights.length > 0 ? highlights.join(" ") : typeof item.text === "string" ? item.text.trim().slice(0, 1e3) : "";
		if (!content) return null;
		return `${content}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`;
	}).filter(Boolean).join("\n\n");
};
const mapExaInlineContent = (results) => {
	if (!results?.length) return [];
	return results.filter((r) => !!r?.url && typeof r.text === "string" && r.text.length > 0).map((r) => ({
		url: r.url,
		title: r.title || "",
		content: r.text,
		error: null
	}));
};
const searchWithExaDirect = async (query, options = {}) => {
	if (reserveExaBudget()) throw new Error("Exa monthly free tier exhausted (1,000 requests). Resets next month.\n  Switch to Brave with provider: 'brave', or upgrade at exa.ai/pricing");
	const apiKey = getExaApiKey();
	if (!(options.includeContent || !!options.recencyFilter || !!options.domainFilter?.length || !!(options.numResults && options.numResults !== 5))) {
		const response = await fetch(EXA_ANSWER_URL, {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				query,
				text: true
			}),
			signal: AbortSignal.any([AbortSignal.timeout(3e4), ...options.signal ? [options.signal] : []])
		});
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Exa API error ${response.status}: ${errorText.slice(0, 300)}`);
		}
		const data = await response.json();
		return {
			answer: data.answer || "",
			results: mapExaResults(data.citations)
		};
	}
	const startDate = options.recencyFilter ? (/* @__PURE__ */ new Date(Date.now() - {
		day: 1,
		week: 7,
		month: 30,
		year: 365
	}[options.recencyFilter] * 864e5)).toISOString() : null;
	const includeDomains = options.domainFilter?.filter((d) => !d.startsWith("-") && d.trim().length > 0).map((d) => d.trim());
	const excludeDomains = options.domainFilter?.filter((d) => d.startsWith("-")).map((d) => d.slice(1).trim()).filter(Boolean);
	const response = await fetch(EXA_SEARCH_URL, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			query,
			type: "auto",
			numResults: options.numResults ?? 5,
			...includeDomains?.length ? { includeDomains } : {},
			...excludeDomains?.length ? { excludeDomains } : {},
			...startDate ? { startPublishedDate: startDate } : {},
			contents: {
				text: options.includeContent ? true : { maxCharacters: 3e3 },
				highlights: true
			}
		}),
		signal: AbortSignal.any([AbortSignal.timeout(3e4), ...options.signal ? [options.signal] : []])
	});
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Exa API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	const data = await response.json();
	const mapped = {
		answer: buildExaAnswerFromSearchResults(data.results),
		results: mapExaResults(data.results)
	};
	if (options.includeContent) {
		const inlineContent = mapExaInlineContent(data.results);
		if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
	}
	return mapped;
};
const isExaAvailable = () => {
	if (getExaApiKey()) return readExaUsage().count < MONTHLY_LIMIT;
	return true;
};
const searchWithExa = async (query, options = {}) => {
	if (!getExaApiKey()) {
		const result = await searchWithExaMcp(query, options);
		if (!result) throw new Error("Exa MCP returned no results");
		return result;
	}
	return searchWithExaDirect(query, options);
};
const buildBraveAnswer = (results) => {
	if (results.length === 0) return "";
	return results.map((r, i) => {
		const combined = [r.description, ...r.extra_snippets ?? []].filter(Boolean).join(" ");
		if (!combined) return null;
		return `${combined}\nSource: ${r.title || `Source ${i + 1}`} (${r.url})`;
	}).filter(Boolean).join("\n\n");
};
const searchWithBrave = async (query, options = {}) => {
	const apiKey = getBraveApiKey();
	if (!apiKey) throw new Error("Brave Search API key not found.\n  1. Get a free key at https://api.search.brave.com/app/dashboard\n  2. Add 'braveApiKey' to extensions/web-access/web-search.json\n  3. Or set BRAVE_API_KEY environment variable");
	const url = new URL(BRAVE_SEARCH_URL);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(Math.min(options.numResults ?? 5, 20)));
	url.searchParams.set("extra_snippets", "true");
	url.searchParams.set("safesearch", "moderate");
	const freshness = freshnessFromRecency(options.recencyFilter);
	if (freshness) url.searchParams.set("freshness", freshness);
	const response = await fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": apiKey
		},
		signal: AbortSignal.any([AbortSignal.timeout(15e3), ...options.signal ? [options.signal] : []])
	});
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) throw new Error("Brave Search API returned unauthorized. Check your braveApiKey in extensions/web-access/web-search.json");
		const errorText = await response.text();
		throw new Error(`Brave API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	const results = (await response.json()).web?.results ?? [];
	return {
		answer: buildBraveAnswer(results),
		results: results.filter((r) => !!r.url).map((r) => ({
			title: r.title || "Untitled",
			url: r.url,
			snippet: r.description || ""
		}))
	};
};
const isBraveAvailable = () => {
	return !!getBraveApiKey();
};
const resolveProvider = (requested) => {
	const config = loadConfig();
	const provider = (typeof requested === "string" ? requested : config.provider) ?? "auto";
	if (provider === "auto") {
		if (isExaAvailable()) return "exa";
		if (isBraveAvailable()) return "brave";
		return "exa";
	}
	if (provider === "exa") return "exa";
	if (provider === "brave") return "brave";
	return "exa";
};
const search = async (query, options = {}) => {
	const resolvedProvider = resolveProvider(options.provider);
	if (resolvedProvider === "exa") try {
		return {
			...await searchWithExa(query, options),
			provider: "exa"
		};
	} catch (err) {
		if (errorMessage(err).toLowerCase().includes("abort")) throw err;
		if (isBraveAvailable()) try {
			return {
				...await searchWithBrave(query, options),
				provider: "brave"
			};
		} catch {}
		throw err;
	}
	if (resolvedProvider === "brave") return {
		...await searchWithBrave(query, options),
		provider: "brave"
	};
	throw new Error(`Unknown provider: ${resolvedProvider}`);
};
//#endregion
//#region extract.ts
const DEFAULT_TIMEOUT_MS = 3e4;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 3e4;
const MIN_USEFUL_CONTENT = 500;
const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced"
});
const REJECTED_TYPES = [
	"application/octet-stream",
	"image/",
	"audio/",
	"video/",
	"application/zip",
	"application/gzip",
	"application/x-tar",
	"application/x-rar-compressed"
];
const isRejectedContentType = (contentType) => {
	const lower = contentType.toLowerCase();
	return REJECTED_TYPES.some((t) => lower.includes(t));
};
const isLikelyJSRendered = (html) => {
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (!bodyMatch) return false;
	const textContent = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
	const scriptCount = (html.match(/<script/gi) || []).length;
	return textContent.length < 500 && scriptCount > 3;
};
const extractHeadingTitle = (text) => {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) return null;
	return match[1].replace(/\*+/g, "").trim() || null;
};
const extractWithJinaReader = async (url, signal) => {
	const jinaUrl = JINA_READER_BASE + url;
	try {
		const res = await fetch(jinaUrl, {
			headers: {
				Accept: "text/markdown",
				"X-No-Cache": "true"
			},
			signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...signal ? [signal] : []])
		});
		if (!res.ok) return null;
		const content = await res.text();
		const contentStart = content.indexOf("Markdown Content:");
		if (contentStart < 0) return null;
		const markdownPart = content.slice(contentStart + 17).trim();
		if (markdownPart.length < 100 || markdownPart.startsWith("Loading...") || markdownPart.startsWith("Please enable JavaScript")) return null;
		return {
			url,
			title: extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url),
			content: markdownPart,
			error: null
		};
	} catch {
		return null;
	}
};
const extractViaHttp = async (url, signal) => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
				"Cache-Control": "no-cache"
			}
		});
		if (!response.ok) return {
			url,
			title: "",
			content: "",
			error: `HTTP ${response.status}: ${response.statusText}`
		};
		const contentType = response.headers.get("content-type") || "";
		const contentLength = response.headers.get("content-length");
		if (contentLength) {
			const length = parseInt(contentLength, 10);
			if (length > MAX_RESPONSE_SIZE) return {
				url,
				title: "",
				content: "",
				error: `Response too large (${Math.round(length / 1024 / 1024)}MB)`
			};
		}
		if (isRejectedContentType(contentType)) return {
			url,
			title: "",
			content: "",
			error: `Unsupported content type: ${contentType.split(";")[0]}`
		};
		const text = await response.text();
		if (!(contentType.includes("text/html") || contentType.includes("application/xhtml+xml"))) return {
			url,
			title: extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url),
			content: text,
			error: null
		};
		const { document } = parseHTML(text);
		const article = new Readability(document).parse();
		if (!article) return {
			url,
			title: "",
			content: "",
			error: isLikelyJSRendered(text) ? "Page appears to be JavaScript-rendered (content loads dynamically)" : "Could not extract readable content from HTML structure"
		};
		const markdown = turndown.turndown(article.content);
		if (markdown.length < MIN_USEFUL_CONTENT) return {
			url,
			title: article.title || "",
			content: markdown,
			error: isLikelyJSRendered(text) ? "Page appears to be JavaScript-rendered (content loads dynamically)" : "Extracted content appears incomplete"
		};
		return {
			url,
			title: article.title || "",
			content: markdown,
			error: null
		};
	} catch (err) {
		const message = errorMessage(err);
		if (message.toLowerCase().includes("abort")) return {
			url,
			title: "",
			content: "",
			error: "Aborted"
		};
		return {
			url,
			title: "",
			content: "",
			error: message
		};
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", onAbort);
	}
};
const extractContent = async (url, signal) => {
	if (signal?.aborted) return {
		url,
		title: "",
		content: "",
		error: "Aborted"
	};
	let parsedUrl;
	try {
		parsedUrl = new URL(url);
	} catch {
		return {
			url,
			title: "",
			content: "",
			error: "Invalid URL"
		};
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return {
		url,
		title: "",
		content: "",
		error: "Only http:// and https:// URLs are supported"
	};
	if (signal?.aborted) return {
		url,
		title: "",
		content: "",
		error: "Aborted"
	};
	const httpResult = await extractViaHttp(url, signal);
	if (signal?.aborted) return {
		url,
		title: "",
		content: "",
		error: "Aborted"
	};
	if (!httpResult.error) return httpResult;
	const jinaResult = await extractWithJinaReader(url, signal);
	if (jinaResult) return jinaResult;
	if (signal?.aborted) return {
		url,
		title: "",
		content: "",
		error: "Aborted"
	};
	const guidance = [
		httpResult.error,
		"",
		"The page could not be extracted. Try:",
		"  • Use web_search to find information about this topic",
		"  • The page may require login or blocks automated access"
	].join("\n");
	return {
		...httpResult,
		error: guidance
	};
};
//#endregion
//#region index.ts
const computeProviderStatus = () => {
	return {
		exa: getExaApiKey() ? "api" : "mcp",
		brave: getBraveApiKey() ? "key-set" : "missing"
	};
};
const formatStatus = (pi, ctx) => {
	const status = computeProviderStatus();
	const theme = ctx.ui.theme;
	const lines = [];
	lines.push(theme.fg("accent", "── Web Search Status ──"));
	const exaLabel = status.exa === "api" ? theme.fg("success", "✓ API key set") : status.exa === "mcp" ? theme.fg("success", "✓ MCP (zero-config)") : theme.fg("error", "✗ unavailable");
	lines.push(`  Exa:   ${exaLabel}`);
	const braveLabel = status.brave === "key-set" ? theme.fg("success", "✓ API key set") : theme.fg("warning", "✗ missing");
	lines.push(`  Brave: ${braveLabel}`);
	const config = loadConfig();
	lines.push(`  Provider: ${config.provider ?? "auto"}`);
	return lines.join("\n");
};
const normalizeQueryList = (raw) => {
	return raw.filter((q) => typeof q === "string").map((q) => q.trim()).filter((q) => q.length > 0);
};
const normalizeNumResults = (value) => {
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.min(20, Math.max(1, Math.floor(value)));
};
const fetchIncludedContent = async (urls, signal, onUpdate) => {
	const limit = pLimit(3);
	const uniqueUrls = [...new Set(urls)].slice(0, 10);
	const tasks = uniqueUrls.map((url, index) => limit(async () => {
		onUpdate?.({
			content: [{
				type: "text",
				text: `Fetching content ${index + 1}/${uniqueUrls.length}: ${url}`
			}],
			details: {
				phase: "fetching_content",
				progress: index / uniqueUrls.length,
				currentQuery: url
			}
		});
		try {
			return await extractContent(url, signal);
		} catch (err) {
			return {
				url,
				title: "",
				content: "",
				error: errorMessage(err)
			};
		}
	}));
	return Promise.all(tasks);
};
const renderSearchCall = (args, theme) => {
	const list = normalizeQueryList(Array.isArray(args.queries) ? args.queries : args.query !== void 0 ? [args.query] : []);
	if (list.length === 0) return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
	if (list.length === 1) {
		const q = list[0];
		const display = q.length > 60 ? q.slice(0, 57) + "..." : q;
		return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`), 0, 0);
	}
	const lines = [theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${list.length} queries`)];
	for (const q of list.slice(0, 5)) {
		const display = q.length > 50 ? q.slice(0, 47) + "..." : q;
		lines.push(theme.fg("muted", `  "${display}"`));
	}
	if (list.length > 5) lines.push(theme.fg("muted", `  ... and ${list.length - 5} more`));
	return new Text(lines.join("\n"), 0, 0);
};
const renderSearchResult = (result, options, theme) => {
	const details = result.details;
	if (options.isPartial) {
		if (details?.phase === "searching") {
			const progress = details.progress ?? 0;
			const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
			const query = details.currentQuery ?? "";
			const display = query.length > 40 ? query.slice(0, 37) + "..." : query;
			return new Text(theme.fg("accent", `[${bar}] ${display}`), 0, 0);
		}
		return new Text(theme.fg("accent", "searching..."), 0, 0);
	}
	if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
	const queryInfo = details?.queryCount === 1 ? "" : `${details?.successfulQueries}/${details?.queryCount} queries, `;
	const providerInfo = details?.provider ? ` via ${details.provider}` : "";
	return new Text(theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources${providerInfo}`), 0, 0);
};
const webAccessExtension = (pi) => {
	pi.on("session_start", () => {});
	pi.on("session_shutdown", () => {});
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web when the user asks for current/external information but does not provide a specific URL to fetch. Use this for topics, names, domains, documentation lookup, comparisons, recent information, or broad research. Do not use this when the user provides a direct http/https URL and asks to read/fetch/summarize that page; use fetch_content instead. Search uses Exa (MCP zero-config, or API with key) or Brave Search (needs API key), and returns a synthesized answer with source citations. For comprehensive research, prefer queries (plural) with 2-4 varied angles. Provider auto-selects: Exa first (MCP if no key, API if key set), then Brave (needs key).",
		promptSnippet: "Routing: use web_search when no direct URL is provided and the user needs web/current/external info. If a URL is present and the request is to read/fetch/summarize that page, use fetch_content. Prefer {queries:[...]} with 2-4 varied angles for research.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query. For research, prefer 'queries' with multiple angles." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence. Vary phrasing and scope across 2-4 queries for best coverage." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
			includeContent: Type.Optional(Type.Boolean({ description: "Also fetch full page content for sources" })),
			recencyFilter: Type.Optional(StringEnum([
				"day",
				"week",
				"month",
				"year"
			], { description: "Filter by recency" })),
			domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" })),
			provider: Type.Optional(StringEnum([
				"auto",
				"exa",
				"brave"
			], { description: "Search provider (default: auto)" }))
		}),
		execute: async (_toolCallId, params, signal, onUpdate, _ctx) => {
			const queryList = normalizeQueryList(Array.isArray(params.queries) ? params.queries : params.query !== void 0 ? [params.query] : []);
			if (queryList.length === 0) return {
				content: [{
					type: "text",
					text: "Error: No query provided. Use 'query' or 'queries' parameter."
				}],
				details: { error: "No query provided" }
			};
			const results = [];
			const allUrls = [];
			let lastProvider;
			for (let i = 0; i < queryList.length; i++) {
				const query = queryList[i];
				onUpdate?.({
					content: [{
						type: "text",
						text: `Searching ${i + 1}/${queryList.length}: "${query}"...`
					}],
					details: {
						phase: "searching",
						progress: i / queryList.length,
						currentQuery: query
					}
				});
				try {
					const response = await search(query, {
						numResults: normalizeNumResults(params.numResults),
						includeContent: params.includeContent,
						recencyFilter: params.recencyFilter,
						domainFilter: params.domainFilter,
						signal,
						provider: params.provider
					});
					results.push({
						query,
						answer: response.answer,
						results: response.results,
						includedContent: response.inlineContent,
						error: null,
						provider: response.provider
					});
					lastProvider = response.provider;
					for (const r of response.results) if (!allUrls.includes(r.url)) allUrls.push(r.url);
				} catch (err) {
					const message = errorMessage(err);
					if (message.toLowerCase().includes("abort")) throw err;
					results.push({
						query,
						answer: "",
						results: [],
						error: message,
						provider: void 0
					});
				}
				if (signal?.aborted) break;
			}
			const successfulCount = results.filter((r) => !r.error).length;
			const totalResults = results.reduce((sum, r) => sum + r.results.length, 0);
			let fetchedContent = [];
			if (params.includeContent && allUrls.length > 0 && !signal?.aborted) {
				const inlineContent = results.flatMap((r) => r.includedContent ?? []);
				const inlineUrls = new Set(inlineContent.map((item) => item.url));
				const extractedContent = await fetchIncludedContent(allUrls.filter((url) => !inlineUrls.has(url)), signal, onUpdate);
				fetchedContent = [...inlineContent, ...extractedContent];
			}
			let output = "";
			for (const r of results) {
				if (queryList.length > 1) output += `## Query: "${r.query}"\n\n`;
				if (r.error) output += `Error: ${r.error}\n\n`;
				else if (r.results.length === 0) output += "No results found.\n\n";
				else {
					output += r.answer ? `${r.answer}\n\n---\n\n**Sources:**\n` : "**Sources:**\n";
					output += r.results.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}`).join("\n\n");
					output += "\n\n";
				}
			}
			if (fetchedContent.length > 0) {
				output += "---\n\n**Fetched Content:**\n\n";
				for (const item of fetchedContent) {
					output += `### ${item.title || item.url}\n${item.url}\n\n`;
					if (item.error) output += `Fetch error: ${item.error}\n\n`;
					else output += `${item.content.slice(0, 12e3)}\n\n`;
				}
			}
			return {
				content: [{
					type: "text",
					text: output.trim()
				}],
				details: {
					queries: queryList,
					queryCount: queryList.length,
					successfulQueries: successfulCount,
					totalResults,
					fetchedContent: fetchedContent.length,
					provider: lastProvider
				}
			};
		},
		renderCall: renderSearchCall,
		renderResult: renderSearchResult
	});
	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: "Fetch a specific http/https URL provided by the user and extract its readable content as markdown. Use this whenever the user provides a direct URL and asks to fetch, read, inspect, extract, summarize, analyze, or tell them what is on that page. Do not use this for broad topic research without a specific URL; use web_search instead. Handles standard HTML pages (via Readability) and falls back to Jina Reader for JavaScript-rendered pages. Returns clean markdown suitable for reading or analysis.",
		promptSnippet: "Routing: use fetch_content when the user provides a direct http/https URL or explicitly asks to fetch/read/summarize a page. Use web_search instead when no direct URL is provided.",
		parameters: Type.Object({ url: Type.String({ description: "The URL to fetch and extract content from (http/https only)" }) }),
		execute: async (_toolCallId, params, signal, _onUpdate, _ctx) => {
			try {
				const result = await extractContent(params.url, signal);
				if (result.error) return {
					content: [{
						type: "text",
						text: `Failed to fetch ${params.url}: ${result.error}`
					}],
					details: {
						url: params.url,
						title: result.title,
						error: result.error
					}
				};
				return {
					content: [{
						type: "text",
						text: result.content
					}],
					details: {
						url: params.url,
						title: result.title
					}
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `Failed to fetch ${params.url}: ${errorMessage(err)}`
					}],
					details: {
						url: params.url,
						error: errorMessage(err)
					}
				};
			}
		},
		renderCall: (args, theme) => {
			const url = args.url;
			const display = url.length > 70 ? url.slice(0, 67) + "..." : url;
			return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display), 0, 0);
		},
		renderResult: (result, _options, theme) => {
			const details = result.details;
			if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			const title = details?.title ? `"${details.title}"` : "";
			return new Text(theme.fg("success", `Fetched ${title}`), 0, 0);
		}
	});
	pi.registerCommand("web-status", {
		description: "Show available search providers and config status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatStatus(pi, ctx), "info");
		}
	});
};
//#endregion
export { webAccessExtension as default };

//# sourceMappingURL=index.mjs.map