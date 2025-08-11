/**
 * 実装した際のバージョン
 * - Foundry VTT 0.11.315
 * - Call of Cthulhu 7th edition 0.10.11 https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT
 */
const canActorCreate = game.user.can("ACTOR_CREATE")
const canItemCreate = game.user.can("ITEM_CREATE")
if (canActorCreate && canItemCreate) {
    Dialog.prompt({
        title: "Charaeno からインポート",
        content: `
      キャラクターシートのURL:<br/>
      <input
          id='charaeno-url'
          placeholder='https://charaeno.com/7th/id'
          style='width: 100%'
      />
  `,
        label: "インポートする",
        render: () => $("#charaeno-url").focus(),
        callback: async () => {
            const input = $("#charaeno-url").val().trim();
            const { api, url, error } = parseInput(input);
            if (error) {
                ui.notifications.warn("入力されたURLが正しくありません。");
                return;
            }
            try {

                const response = await fetch(api);

                const data = await response.json();

                await createCharacter(data, url);
                ui.notifications.info(
                    "インポートに成功しました。アクター一覧を確認してください。"
                );
            } catch (error) {
                ui.notifications.warn("シートの読み込みに失敗しました。");
                console.error(error);
            }
        },
    });
} else {
    ui.notifications.error("ユーザーにはアクターの作製もしくはアイテムの作製の権限が不足しています");
};

const parseInput = (input) => {
    if (!input) {
        return { error: "インポートするURLを入力してください。" };
    }
    let url = null;
    try {
        url = new URL(input);
    } catch (err) {
        console.error(err);
        return { error: "入力されたURLが正しくありません。" };
    }
    if (
        url.host !== "charaeno.com" ||
        url.pathname.substring(1, url.pathname.lastIndexOf("/")) !== "7th"
    ) {
        return { error: "入力されたURLが正しくありません。" };
    }
    const api = `https://charaeno.com/api/v1${url.pathname}/summary`;
    const sheetUrl = `https://charaeno.com${url.pathname}`;
    return { api, url: sheetUrl };
};

const createImportCharactersFolderIfNotExists = async () => {
    // Look for existing "Imported characters" folder
    let importedCharactersFolder = game.folders.find(
        entry =>
            entry.name === "Imported characters" && entry.type === "Actor"
    );

    // Create folder if it doesn't exist
    if (importedCharactersFolder === null || importedCharactersFolder === undefined) {
        // Create the folder
        importedCharactersFolder = await Folder.create({
            name: "Imported characters",
            type: "Actor",
            parent: null,
        });
        ui.notifications.info("フォルダ「Imported characters」を作成しました。");
    }
    return importedCharactersFolder;
};

const createCharacter = async (data, url) => {
    const isGM = game.user.isGM;
    let importedCharactersFolder = "";
    if (game.folders.getName("Imported characters")?.type == "Actor") {
        importedCharactersFolder = game.folders.getName("Imported characters");
    } else {
        if (isGM) importedCharactersFolder = await createImportCharactersFolderIfNotExists();
    }

    let image = data.portraitURL + ".jpg";

    const promises = game.packs.contents
        .filter((pack) => pack.documentClass.documentName === "Item")
        .map((pack) => pack.getDocuments());
    const contents = await Promise.all(promises);

    const items = game.items.contents.concat(contents.flat());

    const LIST = {
        skills: items.filter((i) => i.type === "skill"),
        weapons: items.filter((i) => i.type === "weapon"),
    };

    const actor = await Actor.create({
        name: data.name,
        type: "character",
        img: image,
        folder: importedCharactersFolder.id,
        data: {},
    });
    await updateActorData(actor, data, url);
    await addSkills(actor, data, LIST);
    await addWeapons(actor, data, LIST);
    await addItems(actor, data);

    actor.sheet.render(true);
};

const updateActorData = (actor, data, url) => {
    const updateData = {};
    ["occupation", "age", "sex", "residence", "birthplace"].forEach((key) => {
        updateData[`system.infos.${key}`] = data[key];
    });
    updateData["system.infos.age"] = data.age;
    ["str", "con", "siz", "dex", "app", "int", "pow", "edu"].forEach((key) => {
        updateData[`system.characteristics.${key}.value`] = data.characteristics[key];
    });
    ["hp", "mp", "mov", "db", "build"].forEach((key) => {
        updateData[`system.attribs.${key}.value`] = data.attribute[key];
    });
    updateData["system.attribs.san.value"] = data.attribute.san.value;
    updateData["system.attribs.lck.value"] = data.attribute.luck;

    if (
        ["cash", "spendingLevel", "assetsDetails"]
            .map((key) => data.credit[key])
            .some(Boolean)
    ) {
        updateData["system.flags.manualCredit"] = true;
        updateData[`system.monetary.cash`] = data.credit.cash;
        updateData[`system.monetary.spendingLevel`] = data.credit.spendingLevel;
        updateData[`system.monetary.assets`] = data.credit.assetsDetails;
    }

    const backstories = data.backstory.map((story) => {
        return {
            title: story.name,
            value: story.entries.map((entry) => entry.text.trim()).join("\n"),
        };
    });
    backstories.push({
        title: "メモ",
        value: data.note.trim(),
    });
    updateData["system.biography"] = backstories;

    updateData["system.backstory"] =
        `<p>Auto import from ${url}</p>` +
        backstories
            .map((story) => {
                return `<h2>${story.title}</h2><p>${story.value.replace(
                    /\n/g,
                    "<br/>"
                )}</p>`;
            })
            .join("");

    return actor.update(updateData);
};

const addSkills = async (actor, data, list) => {
    const newSkills = data.skills
        .filter((skill) => skill.value >= 0)
        .map((skill) => {
            let specialization = "";
            let name = skill.name;
            let base = skill.value;
            let eras = {};
            let adjustments = true;
            let xpgain = true;
            let push = true;
            const m = skill.name.match(/^(.+)（(.*)）$/);
            if (m) {
                specialization = m[1];
                name = m[2] === "" ? "未選択" : m[2];
                if (m[1] === "母国語") {
                    specialization = "言語";
                    name = m[2] === "" ? "母国語" : m[2];
                    base = "@EDU";
                } else if (m[1] === "ほかの言語") {
                    specialization = "言語";
                    base = 1;
                } else if (m[1] === "運転" && m[2] === "自動車") {
                    eras = { standard: true, modern: true, modernPulp: true, pulp: true }
                }
            }

            if (skill.name == "投擲") {
                specialization = "近接戦闘"
            }
            const existingSkill = list.skills.find(
                j => (j.system.skillName == name && specialization == "") || (j.system.specialization == specialization && specialization != "" && j.system.skillName == name) || (j.system.specialization == specialization && specialization != "" && j.system.skillName == "専門分野を選ぶ")
            );

            const newSkill = {
                type: "skill",
                img: null,
            };

            if (existingSkill) {
                newSkill.name = existingSkill.name;
                newSkill.img = existingSkill.img;
                newSkill.system = { ...existingSkill.system };
                newSkill.flags = { ...existingSkill.flags };
                if (specialization != "") {
                    newSkill.specialization = specialization;
                    newSkill.skillName = name;
                    newSkill.system.skillName = name;
                    newSkill.system.properties.requiresname = false;
                    newSkill.name = `${specialization} (${name})`
                }
                let experience = skill.value - Number(existingSkill.system.base);
                if (existingSkill.name == "回避") experience = skill.value - Math.ceil(0.5 * actor.system.characteristics.dex.value);
                if (name == "母国語") {
                    experience = skill.value - actor.system.characteristics.edu.value;
                    newSkill.system.properties.requiresname = false;
                }
                if (experience !== 0 && experience !== NaN) {
                    newSkill.system.adjustments = { experience };
                }
                // newSkill.system.base = skill.value; // TODO: find a way to keep the base
                newSkill.system.value = skill.value;
            } else {
                if (name == "回避") {
                    base = "1/2*@DEX";
                    push = false;
                } else if (name == "信用") {
                    base = 0;
                    eras = { standard: true, modern: true, modernPulp: true, pulp: true, downDarkerTrails: true, downDarkerTrailsPulp: true, gasLight: true }
                } else if (name == "クトゥルフ神話") {
                    base = 0;
                    push = false;
                    adjustments = false;
                    xpgain = false;
                }
                newSkill.name = specialization === "" ? name : `${specialization} (${name})`;
                newSkill.flags = {}
                newSkill.flags.CoC7 = {}
                newSkill.flags.CoC7.cocidFlag = eras == {} ? {} : {
                    eras: eras
                }
                push = ["近接戦闘", "射撃"].includes(specialization) ? false : true;
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
    return actor.createEmbeddedDocuments("Item", newSkills);
};

const DEFAULT_PROPERTIES = {
    // special: false,
    rarity: false,
    //push: true,
    // combat: false,
};

const addWeapons = async (actor, data, list) => {
    const weapons = data.weapons.map((weapon) => {
        let name = weapon.name;
        if (name === "素手") {
            name = "こぶし";
        }
        const existingWeapon = list.weapons.find(
            j => j.name.includes(name)
        );

        if (existingWeapon) {
            return existingWeapon;
        } else {
            return null;
        }
    }).filter(i => i !== null);
    return actor.createEmbeddedDocuments("Item", weapons)
};

const addItems = (actor, data) => {
    const items = data.possessions.map((item) => {
        return {
            name: item.name,
            type: "item",
            system: {
                description: { value: item.detail ? `<p>${item.detail}</p>` : "" },
                quantity: item.count ? item.count : 1,
            },
        };
    });
    return actor.addItems(items);
};