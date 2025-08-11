import { load } from "./third_party/js-yaml/js-yaml.mjs";

const removedPacks = ["CoC7.roll-requests", "CoC7.sanity-tables-examples", "CoC7.skills", "CoC7.weapons", "CoC7.examples"];

const LAST_SYNC_KEY = "lastSyncedDataVersion";
const LAST_FOUNDRY_SYNC_KEY = "lastSyncedFoudryVersion";

async function calculateHash(text) {
  if (crypto && crypto.subtle && crypto.subtle.digest) {
    // 1. Convert text to byte sequence
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // 2. SHA-1 hash calc（async）
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);

    // 3. convert ArrayBuffer to Uint8Array
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // 4. hexadecimal string and concatenate
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // fallback dummy
  return "dummy-hash";
}

Hooks.once("ready", async () => {
  // register only once — if already registered this call will throw, so guard accordingly
  try {
    game.settings.register("CoC7ja", LAST_SYNC_KEY, {
      name: `CoC7ja last synced data version`,
      scope: "world",
      config: false,
      type: String,
      default: "0.0.0"
    });
    game.settings.register("CoC7ja", LAST_FOUNDRY_SYNC_KEY, {
      name: `CoC7ja last synced Foundry version`,
      scope: "world",
      config: false,
      type: Number,
      default: 0
    });
  } catch (e) {
    // ignore if already registered
  }

  const isGM = game.user.isGM;
  const currentVersion = (await game.modules.get("CoC7ja")).version;
  if (!currentVersion) {
    console.warn("Could not determine module version; skipping auto-sync.");
    return;
  }

  const lastVersion = game.settings.get("CoC7ja", LAST_SYNC_KEY) ?? "0.0.0";
  const lastFoundryVersion = game.settings.get("CoC7ja", LAST_FOUNDRY_SYNC_KEY) ?? 0;

  if (game.release.generation == lastFoundryVersion) {
    // foundry.utils.isNewerVersion
    if (foundry?.utils?.isNewerVersion) {
      const needSync = foundry.utils.isNewerVersion(currentVersion, lastVersion);
      if (!needSync) {
        console.log(`CoC7ja: data version unchanged (${currentVersion}). Skip heavy sync.`);
        return;
      }
    } else {
      if (currentVersion === lastVersion) {
        console.log(`CoC7ja: version unchanged (${currentVersion}). Skip heavy sync.`);
        return;
      }
    }
  }

  if (isGM) {
    console.log("CoC7ja: Importing macros from YAML and JS files...");

    const tasks = [
      { yamlPath: `macros.yaml`, packName: "macros", packKey: `CoC7ja.macros`, docType: "Macro" },
      { yamlPath: `skill.yaml`, packName: "skill", packKey: `CoC7ja.skill`, docType: "Item" },
      { yamlPath: `tables.yaml`, packName: "tables", packKey: `CoC7ja.tables`, docType: "RollTable" },
      { yamlPath: `rollreq.yaml`, packName: "rollreq", packKey: `CoC7ja.rollreq`, docType: "JournalEntry" },
      { yamlPath: `setup.yaml`, packName: "setup", packKey: `CoC7ja.setup`, docType: "Item" },
    ];

    let ok = true;
    for (const t of tasks) {
      try {
        await updateCompendiumFromYaml("CoC7ja", t.packName, t.yamlPath, t.docType);
        console.log(`Updated pack CoC7ja.${t.packName} (${t.docType})`);
      } catch (err) {
        console.error("Import error for", t.packKey, err);
        ok = false;
      }
    }

    if (ok) {
      await game.settings.set("CoC7ja", LAST_SYNC_KEY, currentVersion);
      await game.settings.set("CoC7ja", LAST_FOUNDRY_SYNC_KEY, !!game.release.generation ? game.release.generation : 0);
      console.log(`CoC7ja: updated lastSyncedDataVersion to ${currentVersion}`);
      console.log("All compendium updates completed.");
    } else {
      console.warn(`CoC7ja: sync failed; lastSyncedDataVersion remains ${lastVersion}`);
    }
  }
});

/**
 * Update the compendium while determining differences from YAML array data
 * Supports loading js files for macro data
 *
 * @param {string} moduleName module ID（name of module.json）
 * @param {string} packName compendium name（moduleId.packName）
 * @param {string} yamlPath YAML file path（Relative path under modules/moduleName/）
 * @param {string} docType Document type name（“Macro” | “Item” | ‘RollTable’ | “JournalEntry,” etc.）
 */
async function updateCompendiumFromYaml(moduleName, packName, yamlPath, docType) {
  const version = game.release.generation;
  const packKey = `${moduleName}.${packName}`;
  const pack = game.packs.get(packKey);

  if (!pack) {
    ui.notifications.error(`Pack not found: ${packKey}`);
    return;
  }

  let unlocked = false;
  if (pack.locked) {
    await pack.configure({ locked: false });
    unlocked = true;
    ui.notifications.info(`Compendium ${packKey} unlocked for update.`);
  } else {
    unlocked = true;
  }

  // 1. Fetch YAML and retrieve text
  const res = await fetch(`modules/${moduleName}/yaml/v${version}/${yamlPath}`);
  if (!res.ok) {
    ui.notifications.error(`Failed to fetch YAML: ${yamlPath}`);
    return;
  }
  const text = await res.text();

  // 2. Hash calc.
  const sourceHash = await calculateHash(text);

  // 3. YAML parsing
  const docsFromYaml = load(text);
  if (!Array.isArray(docsFromYaml)) {
    ui.notifications.error(`YAML format invalid: expected array`);
    return;
  }

  // 4. Compendium load
  const existingDocs = await pack.getDocuments();
  const existingMap = new Map(existingDocs.map(d => [d.name, d]));

  // 5. Detect differences and create an array for updates
  const toCreate = [];
  const toUpdate = [];
  const namesInYaml = new Set();

  if (docType === "Macro") {
    // Load .js file
    for (const e of docsFromYaml) {
      namesInYaml.add(e.name);

      if (!e.path) {
        console.warn("Macro entry missing path:", e);
        continue;
      }
      // Fetch .js file
      const scriptRes = await fetch(`modules/${moduleName}/macros/v${version}/${e.path}`);
      if (!scriptRes.ok) {
        console.warn(`Failed to fetch macro script: ${e.path}`);
        continue;
      }
      const scriptText = await scriptRes.text();

      const existing = existingMap.get(e.name);
      const docFlags = existing?.getFlag(moduleName, "sourceHash");

      const docData = {
        name: e.name,
        type: e.type ?? "script",
        command: scriptText,
        scope: e.scope ?? "global",
        author: e.author ?? game.user.id,
        flags: {
          ...(e.flags ?? {}),
          [moduleName]: { sourceHash }
        },
        img: e.img ?? ""
      };

      if (!existing) toCreate.push(docData);
      else toUpdate.push({ ...docData, _id: existing.id });
    }
  } else if (docType === "JournalEntry") {
    for (const e of docsFromYaml) {
      namesInYaml.add(e.name);

      if (!e.pageName) {
        console.warn("Journal entry missing pages:", e);
        continue;
      }

      const pageData = [...e.pages];
      for (const p of pageData) {
        const htmlRes = await fetch(`modules/${moduleName}/jornals/v${version}/${e.pageName}/${p.path}`);

        if (!htmlRes.ok) {
          console.warn(`Failed to fetch jornal content: ${e.pageName}/${p.path}`);
          continue;
        }

        if (p.type == "text") {
          const htmlText = await htmlRes.text();
          p.text.content = htmlText;
        }
      }

      const existing = existingMap.get(e.name);
      const docFlags = existing?.getFlag(moduleName, "sourceHash");

      const docData = {
        name: e.name,
        pages: { ...pageData },
        flags: {
          ...(e.flags ?? {}),
          [moduleName]: { sourceHash }
        }
      };

      if (!existing) toCreate.push(docData);
      else toUpdate.push({ ...docData, _id: existing.id });
    }
  } else {
    for (const docData of docsFromYaml) {
      namesInYaml.add(docData.name);

      const existing = existingMap.get(docData.name);
      const docFlags = existing?.getFlag(moduleName, "sourceHash");

      // If the hash is different or not registered, update or create.
      if (!existing) {
        // For create
        toCreate.push({
          ...docData,
          flags: {
            ...docData.flags,
            [moduleName]: { sourceHash }
          }
        });
      } else if (docFlags !== sourceHash) {
        // For update - set sourceHash to flags
        toUpdate.push({
          ...docData,
          _id: existing.id,
          flags: {
            ...docData.flags,
            [moduleName]: { sourceHash }
          }
        });
      }
    }
  }

  // 6. For delete
  const toDeleteIds = existingDocs
    .filter(d => !namesInYaml.has(d.name))
    .map(d => d.id);

  // 7. update process
  try {
    const DocClass = CONFIG[docType]?.documentClass;
    if (!!toDeleteIds.length) {
      await DocClass.deleteDocuments(toDeleteIds, { pack: packKey });
      console.log(`Deleted ${toDeleteIds.length} entries from ${packName}`);
    }
    if (!!toCreate.length) {
      await DocClass.createDocuments(toCreate, { pack: packKey });
      console.log(`Created ${toCreate.length} entries in ${packName}`);
    }
    if (!!toUpdate.length) {
      await DocClass.updateDocuments(toUpdate, { pack: packKey });
      console.log(`Updated ${toUpdate.length} entries in ${packName}`);
    }
  } catch (err) {
    console.error("Error updating compendium:", err);
    ui.notifications.error("Error updating compendium. See console.");
  } finally {
    // relock
    if (unlocked) {
      try {
        await pack.configure({ locked: true });
        ui.notifications.info(`Compendium ${packKey} re-locked after update.`);
      } catch (err) {
        console.error(`Failed to re-lock compendium ${packKey}:`, err);
        ui.notifications.warn(`Compendium ${packKey} may remain unlocked; please re-lock manually.`);
      }
    }
  }
}

Hooks.on("renderCompendiumDirectory", function (app, html, other) {
  console.log("Clean Ready")
  html.find('[data-pack]').each(function (li) {
    const pack = game.packs.find(pack => pack.collection === this.dataset.pack);
    if (pack && removedPacks.includes(pack.collection)) {
      $(this).remove();
    }
  });
});
