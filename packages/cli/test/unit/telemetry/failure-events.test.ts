import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryEventStore } from '../../../src/util/telemetry';
import { RootTelemetryClient } from '../../../src/util/telemetry/root';
import {
  getTelemetryReporter,
  setTelemetryReporter,
} from '../../../src/util/telemetry/reporter';
import { parseArguments } from '../../../src/util/get-args';
import getSubcommand from '../../../src/util/get-subcommand';

let telemetry: RootTelemetryClient;
let store: TelemetryEventStore;

beforeEach(() => {
  vi.stubEnv('VERCEL_CLI_TELEMETRY_V2', '1');
  store = new TelemetryEventStore({ isDebug: true, config: {} });
  telemetry = new RootTelemetryClient({ opts: { store } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  setTelemetryReporter(undefined);
});

const keys = () => store.readonlyEvents.map(e => e.key);

describe('trackError', () => {
  const apiError = () =>
    Object.assign(new Error('boom'), {
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      slug: 'rate_limited',
      action: 'retry',
      serverMessage: 'Rate limited',
    });

  it('tracks structured fields for non-agents under v2', () => {
    telemetry.trackError(apiError());
    expect(store.readonlyEvents).toMatchObject([
      { key: 'error_status', value: '429' },
      { key: 'error_code', value: 'TOO_MANY_REQUESTS' },
      { key: 'error_slug', value: 'rate_limited' },
      { key: 'error_action', value: 'retry' },
    ]);
  });

  it('tracks nothing for non-agents without v2', () => {
    vi.stubEnv('VERCEL_CLI_TELEMETRY_V2', '');
    telemetry.trackError(apiError());
    expect(store.readonlyEvents).toHaveLength(0);
  });

  it('adds server message for agents regardless of v2', () => {
    vi.stubEnv('VERCEL_CLI_TELEMETRY_V2', '');
    telemetry.trackError(apiError(), { agent: true });
    expect(keys()).toEqual([
      'error_status',
      'error_code',
      'error_slug',
      'error_action',
      'error_server_message',
    ]);
  });

  it('dedupes structured fields per error object', () => {
    const err = apiError();
    telemetry.trackError(err);
    telemetry.trackError(err, { agent: true });
    // second call only adds the agent-only server message
    expect(keys()).toEqual([
      'error_status',
      'error_code',
      'error_slug',
      'error_action',
      'error_server_message',
    ]);
  });
});

describe('parse errors', () => {
  it('tracks unknown options with a gated flag name', () => {
    setTelemetryReporter(telemetry);
    expect(() => parseArguments(['--pord'], {})).toThrow();
    expect(store.readonlyEvents).toMatchObject([
      { key: 'parse_error', value: 'unknown_option:--pord' },
    ]);
  });

  it('redacts non-flag-shaped option names', () => {
    setTelemetryReporter(telemetry);
    expect(() => parseArguments(['--PORD!'], {})).toThrow();
    expect(store.readonlyEvents[0]?.value).toBe('unknown_option:[REDACTED]');
  });

  it('does not throw without a reporter', () => {
    expect(getTelemetryReporter()).toBeUndefined();
    expect(() => parseArguments(['--pord'], {})).toThrow();
  });
});

describe('command_not_found', () => {
  it('tracks gated token and suggestion', () => {
    telemetry.trackCommandNotFound('deplyo', 'deploy');
    expect(store.readonlyEvents).toMatchObject([
      { key: 'command_not_found', value: 'deplyo' },
      { key: 'command_not_found_suggestion', value: 'deploy' },
    ]);
  });

  it('redacts path-like tokens and defaults suggestion to NONE', () => {
    telemetry.trackCommandNotFound('./secret-dir');
    expect(store.readonlyEvents).toMatchObject([
      { key: 'command_not_found', value: '[REDACTED]' },
      { key: 'command_not_found_suggestion', value: 'NONE' },
    ]);
  });

  it('tracks nothing without v2', () => {
    vi.stubEnv('VERCEL_CLI_TELEMETRY_V2', '');
    telemetry.trackCommandNotFound('deplyo', 'deploy');
    expect(store.readonlyEvents).toHaveLength(0);
  });
});

describe('subcommand_not_found via getSubcommand', () => {
  const config = { ls: ['ls', 'list'], add: ['add'] };

  it('tracks unknown leading tokens when no default route exists', () => {
    setTelemetryReporter(telemetry);
    getSubcommand(['pull-all'], config);
    expect(store.readonlyEvents).toMatchObject([
      { key: 'subcommand_not_found', value: 'pull-all' },
    ]);
  });

  it('ignores known subcommands, empty args, flags, and default routes', () => {
    setTelemetryReporter(telemetry);
    getSubcommand(['ls'], config);
    getSubcommand([], config);
    getSubcommand(['--flag'], config);
    getSubcommand(['anything'], { ...config, default: ['ls'] });
    expect(store.readonlyEvents).toHaveLength(0);
  });
});

describe('trackCrash', () => {
  it('tracks error name and top frame basename', () => {
    const err = new TypeError('user-secret-message');
    err.stack = `TypeError: user-secret-message\n    at foo (/Users/someone/private/repo/dist/index.js:123:45)`;
    telemetry.trackCrash(err);
    expect(store.readonlyEvents).toMatchObject([
      { key: 'crash', value: 'TypeError:index.js:123' },
    ]);
    expect(store.readonlyEvents[0]?.value).not.toContain('secret');
  });

  it('falls back to unknown for missing stacks', () => {
    const err = new Error('x');
    err.stack = undefined;
    telemetry.trackCrash(err);
    expect(store.readonlyEvents[0]?.value).toBe('Error:unknown');
  });

  it('handles non-error values', () => {
    telemetry.trackCrash('string failure');
    expect(store.readonlyEvents[0]?.value).toBe('Error:unknown');
  });
});
