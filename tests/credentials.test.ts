import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialVault,
  type SecretCrypto,
} from "../src/main/credentials";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "forgeboard-credentials-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function createCrypto(available = true): SecretCrypto {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("encrypted:")) {
        throw new Error("invalid encrypted value");
      }
      return text.slice("encrypted:".length);
    },
  };
}

describe("CredentialVault", () => {
  it("encrypts credentials before writing them to disk", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "credentials.json");
    const vault = new CredentialVault(filePath, createCrypto());

    expect(await vault.set("connection-1", "top-secret")).toBe(true);
    expect(await vault.has("connection-1")).toBe(true);
    expect(await vault.get("connection-1")).toBe("top-secret");
    expect(await readFile(filePath, "utf8")).not.toContain("top-secret");
    expect(await readFile(filePath, "utf8")).not.toContain("connection-1:top-secret");
  });

  it("reloads encrypted credentials through an injected crypto provider", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "credentials.json");
    const crypto = createCrypto();
    const firstVault = new CredentialVault(filePath, crypto);
    await firstVault.set("connection-1", "top-secret");

    const secondVault = new CredentialVault(filePath, crypto);
    expect(await secondVault.get("connection-1")).toBe("top-secret");
  });

  it("keeps unavailable-encryption credentials in memory only", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "credentials.json");
    const firstVault = new CredentialVault(filePath, createCrypto(false));

    expect(await firstVault.set("connection-1", "session-secret")).toBe(false);
    expect(await firstVault.has("connection-1")).toBe(true);
    expect(await firstVault.get("connection-1")).toBe("session-secret");

    const restartedVault = new CredentialVault(filePath, createCrypto(false));
    expect(await restartedVault.has("connection-1")).toBe(false);
    expect(await restartedVault.get("connection-1")).toBeUndefined();
  });

  it("deletes persisted and session-only credentials", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "credentials.json");
    const crypto = createCrypto();
    const vault = new CredentialVault(filePath, crypto);
    await vault.set("connection-1", "top-secret");
    await vault.delete("connection-1");

    expect(await vault.has("connection-1")).toBe(false);
    expect(await vault.get("connection-1")).toBeUndefined();
  });

  it("does not include secret values in crypto failures", async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, "credentials.json");
    const crypto: SecretCrypto = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error("failed while handling top-secret");
      },
      decryptString: () => "",
    };
    const vault = new CredentialVault(filePath, crypto);

    await expect(vault.set("connection-1", "top-secret")).rejects.toMatchObject({
      code: "STORAGE",
    });
    expect(await vault.get("connection-1")).toBeUndefined();
  });
});
