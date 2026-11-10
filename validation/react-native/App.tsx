import { createClient, createMemoryCache } from "nexora";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type TestResult = {
  name: string;
  status: "running" | "passed" | "failed";
  detail: string;
};

type RunCase = (name: string, operation: () => void | Promise<void>) => Promise<void>;

type CookieResult = {
  cookie: string;
};

type ServerStats = {
  counts: Record<string, number>;
  canceled: boolean;
  bodyCanceled: boolean;
  authorizationForwarded: boolean;
};

type StructuredCloneGlobal = typeof globalThis & {
  structuredClone?: <T>(value: T) => T;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function identifier(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function getJson<T>(url: string, credentials: "include" | "omit" = "omit"): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { credentials, signal: controller.signal });
    if (!response.ok) throw new Error(`Test service returned HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("The operation unexpectedly succeeded");
}

function verifyPackageExport(): void {
  const client = createClient({ baseUrl: "https://nexora.validation.invalid" });
  assert(typeof createClient === "function", "Nexora package root did not resolve.");
  assert(typeof client.get === "function", "Nexora client export is unavailable.");
}

function verifyStructuredCloneFallback(): void {
  const target = globalThis as StructuredCloneGlobal;
  const descriptor = Object.getOwnPropertyDescriptor(target, "structuredClone");
  Object.defineProperty(target, "structuredClone", {
    configurable: true,
    value: undefined,
  });
  try {
    const cache = createMemoryCache();
    const cyclic: Record<string, unknown> = { value: "original" };
    cyclic.self = cyclic;
    const source = {
      array: [{ value: "nested" }],
      date: new Date("2024-01-02T03:04:05.000Z"),
      expression: /nexora/gi,
      map: new Map([["key", { value: "map" }]]),
      set: new Set([{ value: "set" }]),
      cyclic,
    };
    cache.set("values", source, 10_000);
    source.array[0] = { value: "changed" };
    const copy = cache.get<typeof source>("values");
    assert(copy !== undefined, "Cached value was not returned.");
    assert(
      copy.array[0]?.value === "nested",
      `Nested value changed after mutation: ${String(copy.array[0]?.value)}.`,
    );
    assert(copy.date.getTime() === source.date.getTime(), "Date was not cloned.");
    assert(copy.expression.source === "nexora", "Regular expression was not cloned.");
    assert(copy.map.get("key")?.value === "map", "Map was not cloned.");
    assert([...copy.set][0]?.value === "set", "Set was not cloned.");
    assert(copy.cyclic.self === copy.cyclic, "Circular references were not preserved.");
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(target, "structuredClone");
    } else {
      Object.defineProperty(target, "structuredClone", descriptor);
    }
  }
}

async function runLocalChecks(runCase: RunCase): Promise<void> {
  await runCase("Metro package export", verifyPackageExport);
  await runCase("structuredClone fallback", verifyStructuredCloneFallback);
}

function App() {
  const [origin, setOrigin] = useState("https://10.0.2.2:8443");
  const [secondaryOrigin, setSecondaryOrigin] = useState("https://10.0.2.2:8444");
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  async function runCase(name: string, operation: () => void | Promise<void>): Promise<void> {
    setResults((current) => [...current, { name, status: "running", detail: "" }]);
    try {
      await operation();
      setResults((current) =>
        current.map((item) =>
          item.name === name ? { ...item, status: "passed", detail: "Passed" } : item,
        ),
      );
    } catch (error) {
      setResults((current) =>
        current.map((item) =>
          item.name === name
            ? {
                ...item,
                status: "failed",
                detail: error instanceof Error ? error.message : String(error),
              }
            : item,
        ),
      );
    }
  }

  async function runLocalValidation(): Promise<void> {
    setRunning(true);
    setResults([]);
    try {
      await runLocalChecks(runCase);
    } finally {
      setRunning(false);
    }
  }

  async function runValidation(): Promise<void> {
    const base = normalizeOrigin(origin);
    const crossOrigin = normalizeOrigin(secondaryOrigin);
    if (!base.startsWith("https://") || !crossOrigin.startsWith("https://")) {
      setResults([
        {
          name: "Configuration",
          status: "failed",
          detail: "Both test service origins must use HTTPS.",
        },
      ]);
      return;
    }

    setRunning(true);
    setResults([]);
    const client = createClient({
      baseUrl: base,
      credentials: "omit",
      timeout: 8_000,
      cache: { enabled: true, ttl: 60_000, policy: "cache-first" },
      retry: { maxRetries: 0 },
    });

    await runLocalChecks(runCase);

    await runCase("credentials omit and cookie isolation", async () => {
      const firstValue = identifier();
      await getJson(`${base}/cookie/set?value=${firstValue}`, "include");
      const firstProbe = await getJson<CookieResult>(
        `${base}/cookie/echo?probe=${identifier()}`,
        "include",
      );
      assert(
        firstProbe.cookie.includes(firstValue),
        "The native cookie jar did not retain the initial test cookie; omission is inconclusive.",
      );
      const first = await client.get<CookieResult>("/cookie/echo?resource=shared");
      const secondValue = identifier();
      await getJson(`${base}/cookie/set?value=${secondValue}`, "include");
      const secondProbe = await getJson<CookieResult>(
        `${base}/cookie/echo?probe=${identifier()}`,
        "include",
      );
      assert(
        secondProbe.cookie.includes(secondValue),
        "The native cookie jar did not retain the replacement test cookie.",
      );
      const cached = await client.get<CookieResult>("/cookie/echo?resource=shared");
      assert(first.cookie === "", "credentials: omit sent an ambient cookie.");
      assert(cached.cookie === "", "Cached response contained an ambient cookie.");
    });

    await runCase("managed bearer redirect protection", async () => {
      const requestId = identifier();
      const authenticatedClient = createClient({
        baseUrl: base,
        credentials: "omit",
        timeout: 8_000,
        auth: { getToken: () => "nexora-validation-token" },
        retry: { maxRetries: 0 },
      });
      const sameOriginFailure = await captureFailure(
        authenticatedClient.get(`/redirect/same-origin?id=${requestId}`),
      );
      assert(
        errorName(sameOriginFailure) !== "UnknownError",
        "Same-origin managed-auth redirect was not rejected.",
      );
      const crossRequestId = identifier();
      const crossOriginFailure = await captureFailure(
        authenticatedClient.get(`/redirect/cross-origin?id=${crossRequestId}`, {
          headers: { "X-Nexora-Secondary-Origin": crossOrigin },
        }),
      );
      assert(
        errorName(crossOriginFailure) !== "UnknownError",
        "Cross-origin managed-auth redirect was not rejected.",
      );
      const stats = await getJson<ServerStats>(`${base}/stats?id=${crossRequestId}`);
      assert(!stats.authorizationForwarded, "Bearer token reached the cross-origin target.");
    });

    await runCase("native request cancellation", async () => {
      const requestId = identifier();
      const controller = new AbortController();
      const pending = client.get(`/slow?id=${requestId}&ms=10000`, {
        signal: controller.signal,
      });
      await delay(150);
      controller.abort();
      const error = await captureFailure(pending);
      assert(errorName(error) === "AbortError", `Expected AbortError, got ${errorName(error)}.`);
      await delay(100);
      const stats = await getJson<ServerStats>(`${base}/stats?id=${requestId}`);
      assert(stats.canceled, "The server did not observe cancellation of the native request.");
    });

    await runCase("retry-delay cancellation", async () => {
      const requestId = identifier();
      const controller = new AbortController();
      const retryingClient = createClient({
        baseUrl: base,
        credentials: "omit",
        timeout: 8_000,
        retry: { maxRetries: 2, baseDelay: 2_000, maxDelay: 2_000 },
      });
      const pending = retryingClient.get(`/retry?id=${requestId}`, {
        signal: controller.signal,
      });
      await delay(150);
      controller.abort();
      const error = await captureFailure(pending);
      assert(errorName(error) === "AbortError", `Expected AbortError, got ${errorName(error)}.`);
      await delay(2_200);
      const stats = await getJson<ServerStats>(`${base}/stats?id=${requestId}`);
      assert(
        (stats.counts["/retry"] ?? 0) === 1,
        "A retry was sent after cancellation during the retry delay.",
      );
    });

    await runCase("response body cancellation", async () => {
      const requestId = identifier();
      const retryingClient = createClient({
        baseUrl: base,
        credentials: "omit",
        timeout: 8_000,
        retry: { maxRetries: 1, baseDelay: 0, maxDelay: 0 },
      });
      const value = await retryingClient.get<{ ok: boolean }>(`/stream-retry?id=${requestId}`);
      assert(value.ok, "The request did not succeed after retrying the streamed response.");
      const stats = await getJson<ServerStats>(`${base}/stats?id=${requestId}`);
      assert(stats.bodyCanceled, "The server did not observe response body cancellation.");
    });

    setRunning(false);
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nexora React Native validation</Text>
      <Text style={styles.caption}>
        Run on Hermes with the test service reachable over trusted HTTPS.
      </Text>
      <TextInput
        accessibilityLabel="Primary test service origin"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setOrigin}
        placeholder="https://host:8443"
        style={styles.input}
        value={origin}
      />
      <TextInput
        accessibilityLabel="Secondary test service origin"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSecondaryOrigin}
        placeholder="https://host:8444"
        style={styles.input}
        value={secondaryOrigin}
      />
      <Pressable
        accessibilityRole="button"
        disabled={running}
        onPress={() => void runLocalValidation()}
        style={[styles.button, running && styles.disabledButton]}
      >
        {running ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Run local checks</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={running}
        onPress={() => void runValidation()}
        style={[styles.button, running && styles.disabledButton]}
      >
        {running ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Run network checks</Text>
        )}
      </Pressable>
      <Text style={styles.summary}>
        {passed} passed · {failed} failed
      </Text>
      {results.map((result) => (
        <View key={result.name} style={styles.result}>
          <Text style={styles.resultTitle}>
            {result.status === "passed" ? "PASS" : result.status === "failed" ? "FAIL" : "RUN"}
            {"  "}
            {result.name}
          </Text>
          <Text style={styles.detail}>{result.detail}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f6f7fb",
    flexGrow: 1,
    padding: 20,
  },
  title: {
    color: "#152238",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  caption: {
    color: "#53627a",
    fontSize: 14,
    marginBottom: 18,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#bcc6d4",
    borderRadius: 8,
    borderWidth: 1,
    color: "#152238",
    marginBottom: 10,
    padding: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2457c5",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    marginTop: 4,
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  summary: {
    color: "#152238",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 22,
  },
  result: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    marginTop: 10,
    padding: 12,
  },
  resultTitle: {
    color: "#152238",
    fontWeight: "700",
  },
  detail: {
    color: "#53627a",
    marginTop: 4,
  },
});

export default App;
