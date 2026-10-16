// Adapter around unmodified, checksum-pinned pi-web-search sources.
import { webSearch, WebSearchSchema } from '../../vendor/pi-web-search/src/web_search.ts';
import { urlContext, UrlContextSchema } from '../../vendor/pi-web-search/src/url_context.ts';
import { getProviderKind } from '../../vendor/pi-web-search/src/providers/config.ts';
import { configureWeb } from './gate.mjs';

export default function (pi) {
  configureWeb(pi, { webSearch, WebSearchSchema, urlContext, UrlContextSchema, getProviderKind });
}
