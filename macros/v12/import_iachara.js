/**
 * 実装した際のバージョン
 * - Foundry VTT 0.12.331
 * - Call of Cthulhu 7th edition 7.6 https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT
 */

// Helper function to extract basic character information from parsed lines
const extractCharacterInfo = (lines, getVal, getCharacteristic) => {
    const name = getVal("名前").replace(" ()", "");
    const age = (getVal("年齢").match(/\d+/) || [])[0] || "";

    // Extract sex from format "性別: 男/女"
    const sex = (() => {
        const line = lines.find(l => l.includes("性別:"));
        if (!line) return "";
        const match = line.match(/性別:\s*([^\/\s]+)/);
        return match ? match[1] : "";
    })();

    // Extract birthplace from format "出身: 東京/日本"
    const birthplace = (() => {
        const line = lines.find(l => l.includes("出身:"));
        if (!line) return "";
        const match = line.match(/出身:\s*([^\s/]+)/);
        return match ? match[1] : "";
    })();

    const occu = getVal("職業");

    // Extract character characteristics (STR, CON, etc.)
    const characteristics = {
        str: { value: getCharacteristic("STR") },
        con: { value: getCharacteristic("CON") },
        pow: { value: getCharacteristic("POW") },
        dex: { value: getCharacteristic("DEX") },
        app: { value: getCharacteristic("APP") },
        siz: { value: getCharacteristic("SIZ") },
        int: { value: getCharacteristic("INT") },
        edu: { value: getCharacteristic("EDU") }
    };

    // Extract derived attributes
    const hp = getCharacteristic("HP");
    const mp = getCharacteristic("MP");
    const san = getCharacteristic("SAN");
    const lck = getCharacteristic("幸運");
    const mov = getCharacteristic("MOV");
    const db = getVal("DB");    // Damage Bonus
    const build = getVal("BLD"); // Build

    return {
        name,
        age,
        sex,
        birthplace,
        occu,
        characteristics,
        hp,
        mp,
        san,
        lck,
        mov,
        db,
        build
    };
};

// Helper function to parse backstory sections with titles in brackets [title]
const parseBackstories = (lines) => {
    const backstories = [];
    const backstoryStart = lines.findIndex(l => l.includes("【バックストーリー】"));
    const backstoryEnd = lines.findIndex(l => l.includes("【通過したシナリオ名】"));

    if (backstoryStart >= 0) {
        let currentTitle = null;
        let currentContent = [];

        // Process each line between backstory markers
        for (let i = backstoryStart + 1; i < (backstoryEnd >= 0 ? backstoryEnd : lines.length); i++) {
            const titleMatch = lines[i].match(/^\[(.+?)\]$/);
            if (titleMatch) {
                // Found a new title, save previous section if exists
                if (currentTitle !== null) {
                    backstories.push({ title: currentTitle, value: currentContent.join("\n").trim() });
                }
                currentTitle = titleMatch[1];
                currentContent = [];
            } else if (currentTitle !== null) {
                currentContent.push(lines[i]);
            }
        }

        // Save the last backstory section
        if (currentTitle !== null) {
            backstories.push({ title: currentTitle, value: currentContent.join("\n").trim() });
        }
    }

    // Add memo section if it exists
    const memoIndex = lines.findIndex(l => l.includes("【メモ】"));
    if (memoIndex >= 0) {
        const memoLine = lines[memoIndex + 1] || "";
        backstories.push({ title: "メモ", value: memoLine.trim() });
    }

    // Convert backstories to HTML format
    const bsa = backstories
        .map((story) => {
            return `<h2>${story.title}</h2><p>${story.value.replace(
                /\n/g,
                "<br/>"
            )}</p>`;
        })
        .join("");

    return { backstories, bsa };
};

// Helper function to process character portrait/icon
const processCharacterImage = (input) => {
    let img = "icons/svg/mystery-man.svg"; // Default image
    const portraitMatch = input.match(/【アイコン】\s*:(https?:\/\/\S+)/);
    if (portraitMatch) {
        const url = portraitMatch[1];
        // Check if it's an iaproject.app image URL and convert it
        const urlMatch = url.match(/^https:\/\/image\.iaproject\.app\/([a-f0-9\-]{36})$/);
        if (urlMatch) {
            const imageId = urlMatch[1];
            // Use weserv.nl proxy to convert image format
            img = `https://images.weserv.nl/?url=image.iaproject.app/${imageId}&output=jpg.jpg`;
        } else {
            img = url; // Use URL as-is if it's a different format
        }
    }
    return img;
};

// Helper function to parse skills section from the character sheet
const parseSkills = (lines) => {
    const skills = [];
    let skillSection = false;
    for (const line of lines) {
        // Look for the skills table header
        if (line.includes("技能名") && line.includes("合計")) {
            skillSection = true;
            continue;
        }
        if (skillSection) {
            // Skills section ends when we reach weapons section
            if (line.includes("戦闘・武器・防具")) {
                skillSection = false;
                continue;
            }

            // Skip empty lines and comment lines
            if (line.trim() === "" || line.startsWith("『")) continue;

            // Parse skill name and value (format: "技能名 値 その他")
            const m = line.match(/^(.+?)\s+(\d{1,3})\s/);
            if (m) {
                skills.push({ name: m[1], value: parseInt(m[2]) });
            }
        }
    }
    return skills;
};

// Helper function to parse weapons section from the character sheet
const parseWeapons = (lines) => {
    const weapons = [];
    let weaponSection = false;
    for (const line of lines) {
        // Look for weapons section header
        if (line.includes("【戦闘・武器・防具】")) {
            weaponSection = true;
            continue;
        }

        if (weaponSection) {
            // Weapons section ends when we reach items section
            if (line.includes("【所持品】")) {
                weaponSection = false;
                continue;
            }
            // Skip table header
            if (line.startsWith("名前")) continue;

            // Parse weapon name (format: "武器名 数値 その他")
            const m = line.match(/^(.+?)\s+\d+/);
            if (m) {
                weapons.push({ name: m[1] });
            }
        }
    }
    return weapons;
};

// Helper function to parse and add inventory items
const parseItems = (lines) => {
    const itemDatas = [];
    const itemStart = lines.findIndex(l => l.includes("【所持品】"));
    if (itemStart >= 0) {
        // Process each line in the items section
        for (let i = itemStart + 2; i < lines.length; i++) {
            const line = lines[i].trim();
            // Stop at money/debt lines or next section
            if (!line || line.startsWith("現在の所持金") || line.startsWith("借金") || line.startsWith("【")) break;

            // Parse item line (format: "アイテム名 単価 個数 価格 効果・備考")
            const match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
            if (match) {
                const name = match[1].trim();
                const quantity = parseInt(match[3], 10);
                const effect = match[5].trim();

                itemDatas.push({
                    name,
                    type: "item",
                    system: {
                        description: { value: `<p>${effect}</p>` },
                        quantity
                    }
                });
            }
        }
    }
    return itemDatas;
};

// Helper function to load all available items from game and compendiums
const loadGameItems = async () => {
    const promises = game.packs.contents
        .filter((pack) => pack.documentClass.documentName === "Item")
        .map((pack) => pack.getDocuments());
    const contents = await Promise.all(promises);

    // Combine world items with compendium items
    const items = game.items.contents.concat(contents.flat());

    // Categorize items for later lookup
    return {
        skills: items.filter((i) => i.type === "skill"),
        weapons: items.filter((i) => i.type === "weapon"),
    };
};

// Helper function to create character actor with all parsed data
const createCharacterActor = async (basicInfo, attributes, img, backstories, bsa) => {
    let image = img;
    const isGM = game.user.isGM;
    let folder = "";
    if (game.folders.getName("Imported characters")?.type == "Actor") {
        folder = game.folders.getName("Imported characters");
    } else {
        if (isGM) folder = await createImportCharactersFolderIfNotExists();
    }
    const canUPLOADFILE = game.user.can("FILES_UPLOAD");
    const canFileBrowse = game.user.can("FILES_BROWSE");
    if (canUPLOADFILE && canFileBrowse) {
        const imgfolder = await createImortImageFolderIfNotExists();
        if (!!imgfolder) image = await uploadImportImage(img, basicInfo.name);
    }

    const actorData = {
        name: basicInfo.name || "新規キャラクター",
        type: "character",
        img: image,
        folder: folder?.id,
        system: {
            characteristics: attributes.characteristics,
            attribs: {
                hp: { value: attributes.hp, max: attributes.hp },
                mp: { value: attributes.mp, max: attributes.mp },
                san: { value: attributes.san, max: attributes.san },
                lck: { value: attributes.lck, max: attributes.lck },
                mov: { value: attributes.mov },
                db: { value: attributes.db },
                build: { value: attributes.build }
            },
            infos: {
                age: basicInfo.age,
                sex: basicInfo.sex,
                birthplace: basicInfo.birthplace,
                occupation: basicInfo.occu
            },
            backstory: bsa,
            biography: [
                ...backstories
            ]
        }
    };

    return await Actor.create(actorData);
};

// Helper function to process and convert skills data for FoundryVTT
const processSkills = (skills, availableSkills, characteristics) => {
    return skills
        .filter((skill) => skill.value >= 0) // Only add skills with values > 0
        .map((skill) => {
            let specialization = "";
            let name = skill.name;
            let base = skill.value;
            let eras = {};
            let adjustments = true;
            let xpgain = true;
            let push = true;

            // Handle specialized skills (format: "専門分野(詳細)")
            const m = skill.name.match(/^(.+)\((.*)\)$/);
            if (m) {
                specialization = m[1];
                name = m[2] === "" ? "未選択" : m[2];

                // Special handling for language skills
                if (m[1] === "母国語") {
                    specialization = "言語";
                    name = m[2] === "" ? "未選択" : m[2];
                    base = "@EDU"; // Base value is EDU characteristic
                } else if (m[1] === "ほかの言語") {
                    specialization = "言語";
                    base = 1; // Base value is 1%
                } else if (m[1] === "運転" && m[2] === "自動車") {
                    // Driving (automobile) is available in multiple eras
                    eras = { standard: true, modern: true, modernPulp: true, pulp: true }
                } else if (m[1] === "芸術" || m[1] === "製作") {
                    specialization = "芸術／製作"
                } else if (m[2].includes("ライフル") || m[2].includes("ショットガン")) {
                    name = "ライフル／ショットガン";
                }
            }

            // Handle skills that should be treated as specializations
            if (skill.name == "投擲") {
                specialization = "近接戦闘"
            }
            if (skill.name == "運転" && specialization == "") {
                specialization = "運転";
                name = "未選択"
            }
            if (skill.name == "科学" && specialization == "") {
                specialization = "科学";
                name = "未選択"
            }
            if (skill.name == "近接戦闘" && specialization == "") {
                specialization = "近接戦闘";
                name = "未選択"
            }
            if (skill.name == "芸術" && specialization == "") {
                specialization = "芸術／製作";
                name = "未選択"
            }
            if (skill.name == "製作" && specialization == "") {
                specialization = "芸術／製作";
                name = "未選択"
            }
            if (skill.name == "操縦" && specialization == "") {
                specialization = "操縦";
                name = "未選択"
            }

            // Try to find existing skill in the system
            const existingSkill = availableSkills.find(
                j => (j.system.skillName == name && specialization == "") ||
                    (j.system.specialization == specialization && specialization != "" && j.system.skillName == name) ||
                    (j.system.specialization == specialization && specialization != "" && j.system.skillName == "専門分野を選ぶ")
            );

            // Create new skill object
            const newSkill = {
                type: "skill",
                img: null,
            };

            if (existingSkill) {
                // Use existing skill as template
                newSkill.name = existingSkill.name;
                newSkill.img = existingSkill.img;
                newSkill.system = { ...existingSkill.system };
                newSkill.flags = { ...existingSkill.flags };

                // Handle specialized skills
                if (specialization != "") {
                    newSkill.specialization = specialization;
                    newSkill.skillName = name;
                    newSkill.system.skillName = name;
                    newSkill.system.properties.requiresname = false;
                    newSkill.name = `${specialization} (${name})`
                }

                // Calculate experience points (imported value - base value)
                let experience = skill.value - Number(existingSkill.system.base);

                // Special calculations for certain skills
                if (existingSkill.name == "回避") {
                    experience = skill.value - Math.ceil(0.5 * characteristics.dex.value);
                }
                if (name == "母国語") {
                    experience = skill.value - characteristics.edu.value;
                    newSkill.system.properties.requiresname = false;
                }

                // Add experience points if any
                if (experience !== 0 && experience !== NaN) {
                    newSkill.system.adjustments = { experience };
                }

                // Set the final skill value
                newSkill.system.value = skill.value;
            } else {
                // Create new skill from scratch if not found in system

                // Special base values for certain skills
                if (name == "回避") {
                    base = "1/2*@DEX"; // Half of DEX characteristic
                    push = false;
                } else if (name == "信用") {
                    base = 0;
                    // Credit Rating is available in all eras
                    eras = { standard: true, modern: true, modernPulp: true, pulp: true, downDarkerTrails: true, downDarkerTrailsPulp: true, gasLight: true }
                } else if (name == "クトゥルフ神話") {
                    base = 0;
                    push = false;        // Cannot be pushed
                    adjustments = false; // Cannot be adjusted
                    xpgain = false;     // Cannot gain experience
                }

                // Set skill name
                newSkill.name = specialization === "" ? name : `${specialization} (${name})`;

                // Set flags for era availability
                newSkill.flags = {}
                newSkill.flags.CoC7 = {}
                newSkill.flags.CoC7.cocidFlag = eras == {} ? {} : {
                    eras: eras
                }

                // Combat skills cannot be pushed
                push = ["近接戦闘", "射撃"].includes(specialization) ? false : true;

                // Create skill system data
                newSkill.system = {
                    value: skill.value,
                    base: base,
                    specialization,
                    skillName: name,
                    properties: {
                        ...DEFAULT_PROPERTIES,
                        special: specialization !== "",
                        combat: ["近接戦闘", "射撃"].includes(specialization),
                        fighting: specialization === "近接戦闘",
                        firearm: specialization === "射撃",
                        noadjustments: !adjustments,
                        noxpgain: !xpgain,
                        push: push
                    },
                };
            }
            return newSkill;
        });
};

// Helper function to process and convert weapons data for FoundryVTT
const processWeapons = (weapons, availableWeapons) => {
    return weapons
        .map((weapon) => {
            let name = weapon.name;
            // Handle alternate weapon names
            if (name == "素手") name = "こぶし";

            // Find matching weapon in the system
            const existingWeapon = availableWeapons.find(
                j => j.name.includes(name)
            );

            if (existingWeapon) {
                return existingWeapon;
            } else {
                return null; // Weapon not found in system
            }
        }).filter(i => i !== null); // Remove null entries
};

const canActorCreate = game.user.can("ACTOR_CREATE")
const canItemCreate = game.user.can("ITEM_CREATE")

if (canActorCreate && canItemCreate) {
    // Main function to display import dialog and handle character import
    Dialog.prompt({
        title: "いあきゃら テキストからインポート",
        content: `
      いあきゃら（7版形式）のキャラクターシートを貼り付けてください：<br/>
      <textarea
        id="iachara-input"
        placeholder="テキスト出力データの全文をここに貼り付け"
        style="width:100%; height:300px; font-family:monospace"
      ></textarea>
    `,
        label: "インポートする",
        render: () => $("#iachara-input").focus(),
        callback: async () => {
            // Get input text from textarea and validate it
            const input = $("#iachara-input").val().trim();
            if (!input) {
                ui.notifications.warn("テキストを入力してください。");
                return;
            }

            try {
                // Split input into lines and trim whitespace
                const lines = input.split("\n").map(l => l.trim());

                // Validate that this is a proper Iachara 7th edition format
                const validHeader = lines.some(line => line.includes("いあきゃらテキスト 7版"));
                if (!validHeader) {
                    ui.notifications.warn("「いあきゃらテキスト 7版」形式のテキストではありません。正しい形式で貼り付けてください。");
                    return;
                }

                // Helper function to extract value from a labeled line (e.g., "名前: 田中太郎")
                const getVal = (label) => {
                    const line = lines.find(l => l.startsWith(label));
                    return line ? line.split(":")[1]?.trim() ?? "" : "";
                };

                // Helper function to extract numeric characteristics (e.g., "STR 15")
                const getCharacteristic = (key) => {
                    const reg = new RegExp(`^${key}\\s+(\\d+)`);
                    const line = lines.find(l => l.match(reg));
                    return line ? parseInt(line.match(reg)[1], 10) : 0;
                };

                // Extract basic character information
                const characterInfo = extractCharacterInfo(lines, getVal, getCharacteristic);
                const { name, age, sex, birthplace, occu, characteristics, hp, mp, san, lck, mov, db, build } = characterInfo;
                // Parse backstory section
                const { backstories, bsa } = parseBackstories(lines);

                // Process character portrait/icon
                const img = processCharacterImage(input);


                // Load available items for reference
                const LIST = await loadGameItems();

                // Parse skills section from the character sheet
                const skills = parseSkills(lines);

                // Parse weapons section from the character sheet
                const weapons = parseWeapons(lines);

                // Create character actor
                const actor = await createCharacterActor(
                    { name, age, sex, birthplace, occu },
                    { characteristics, hp, mp, san, lck, mov, db, build },
                    img,
                    backstories,
                    bsa
                );

                // Process and add skills to the character
                const newSkills = processSkills(skills, LIST.skills, characteristics);
                actor.createEmbeddedDocuments("Item", newSkills);

                // Process and add weapons to the character
                const newWeapons = processWeapons(weapons, LIST.weapons);
                await actor.createEmbeddedDocuments("Item", newWeapons);

                // Parse and add inventory items
                const itemDatas = parseItems(lines);
                actor.addItems(itemDatas);

                // Show success notification
                ui.notifications.info(`${actor.name} を作成しました。`);
            } catch (err) {
                // Handle and log any errors during import
                console.error("インポート失敗:", err);
                ui.notifications.error("テキストの形式が正しくないか、読み取りに失敗しました。");
            }
        }
    });
} else {
    ui.notifications.error("ユーザーにはアクターの作製もしくはアイテムの作製の権限が不足しています");
};

// Default properties for skill creation
const DEFAULT_PROPERTIES = {
    // special: false,
    rarity: false,
    //push: true,
    // combat: false,
};

// Helper function to create or find the folder for imported characters
const createImportCharactersFolderIfNotExists = async () => {
    // Look for existing "Imported characters" folder
    let folder = game.folders.find(
        (f) => f.name === "Imported characters" && f.type === "Actor"
    );

    // Create folder if it doesn't exist
    if (!folder) {
        folder = await Folder.create({
            name: "Imported characters",
            type: "Actor",
            parent: null
        });
        ui.notifications.info("フォルダ「Imported characters」を作成しました。");
    }
    return folder;
};

const createImortImageFolderIfNotExists = async () => {
    let folder = undefined;
    let source = "data";
    if (typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge) {
        source = "forgevtt";
    }
    try {
        folder = await FilePicker.browse(source, "uploadedCharacterImage");
        return folder
    }
    catch (error) {
        try {
            folder = await FilePicker.createDirectory(source, "uploadedCharacterImage");
            return folder
        } catch (error2) {
            let fl = "Local folder"
            if (source == "forgevtt") fl = "Forge VTT Folder"
            console.error(`アップロード用の規定のフォルダ『uploadedCharacterImage(${fl})』が存在していなく、ユーザーにフォルダ作成の権限がありません。一度GMがキャラクターをアップロードすれば、規定のフォルダが自動作成されます。`)
            return folder
        }
    }
};

const uploadImportImage = async (img, name) => {
    let source = "data";
    if (typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge) {
        source = "forgevtt";
    }
    const response = await fetch(img);
    const blob = await response.blob();
    const contentType = response.headers.get("Content-Type"); // e.g., "image/png"
    const extension = contentType.split("/")[1];
    const title = name;

    const file = new File([blob], `${name}.${extension}`, { type: contentType });
    const uploadResult = await FilePicker.upload(source, "uploadedCharacterImage", file, {});
    return uploadResult?.path
};