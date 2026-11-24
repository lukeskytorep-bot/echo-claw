import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createEchoPluginDefinition } from '../src/openclaw/plugin-definition.mjs';
export default definePluginEntry(createEchoPluginDefinition());
