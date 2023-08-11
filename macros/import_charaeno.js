/**
 * 実装した際のバージョン
 * - Foundry VTT 0.11.307
 * - Call of Cthulhu 7th edition 0.10.5 https://github.com/HavlockV/CoC7-FoundryVTT/
 */
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
  let importedCharactersFolder = game.folders.find(
    entry =>
      entry.name === "Imported characters" && entry.type === "Actor"
  );
  if (importedCharactersFolder === null || importedCharactersFolder === undefined) {
    // Create the folder
    importedCharactersFolder = await Folder.create({
      name: "Imported characters",
      type: "Actor",
      parent: null,
    });
    ui.notifications.info("Created Imported Characters folder");
  }
  return importedCharactersFolder;
};

const createCharacter = async (data, url) => {
  let importedCharactersFolder =
    await createImportCharactersFolderIfNotExists();

  const promises = game.packs.contents
    .filter((pack) => pack.documentClass.documentName === "Item")
    .map((pack) => pack.getDocuments());
  const contents = await Promise.all(promises);
  const items = game.items.contents.concat(contents.flat());

  const LIST = {
    skills: items.filter((i) => i.type === "skill"),
    // weapons: items.filter((i) => i.type === "weapon"),
  };

  const actor = await Actor.create({
    name: data.name,
    type: "character",
    folder: importedCharactersFolder.id,
    data: {},
  });
  await updateActorData(actor, data, url);
  await addSkills(actor, data, LIST);
  // await addWeapons(actor, data, LIST); // TODO: やる気が無くなった
  await addItems(actor, data);

  // actor.sheet.render(true);
};

const updateActorData = (actor, data, url) => {
  const updateData = {};
  ["occupation", "age", "sex", "residence", "birthplace"].forEach((key) => {
    updateData[`data.infos.${key}`] = data[key];
  });
  updateData["data.infos.age"] = data.age;
  ["str", "con", "siz", "dex", "app", "int", "pow", "edu"].forEach((key) => {
    updateData[`data.characteristics.${key}.value`] = data.characteristics[key];
  });
  ["hp", "mp", "mov", "db", "build"].forEach((key) => {
    updateData[`data.attribs.${key}.value`] = data.attribute[key];
  });
  updateData["data.attribs.san.value"] = data.attribute.san.value;
  updateData["data.attribs.lck.value"] = data.attribute.luck;

  if (
    ["cash", "spendingLevel", "assetsDetails"]
      .map((key) => data.credit[key])
      .some(Boolean)
  ) {
    updateData["data.flags.manualCredit"] = true;
    updateData[`data.monetary.cash`] = data.credit.cash;
    updateData[`data.monetary.spendingLevel`] = data.credit.spendingLevel;
    updateData[`data.monetary.assets`] = data.credit.assetsDetails;
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
  updateData["data.biography"] = backstories;

  updateData["data.backstory"] =
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
    .filter((skill) => skill.value > 0)
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
        name = m[2] === "" ? "専門分野を選ぶ" : m[2];
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

      const existingSkill = list.skills.find(
        j => j.system.skillName == name && j.system.specialization == specialization
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
        const experience = skill.value - Number(existingSkill.system.base);
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
        newSkill.flags.CoC7.cocidFlag = eras === {} ? {} : {
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

// // TODO: やる気が無くなった
// const addWeapons = async (actor, data, list) => {
//   const weapons = data.weapons.map((weapon) => {
//     let name = weapon.name;
//     if (name === "素手") {
//       name = "こぶし";
//     }
//     const existingWeapon = list.weapons.find((i) => i.data.name === name);
//     const newWeapon = {
//       name: name,
//       type: "weapon",
//       data: {
//         properties: {
//           rngd: !Boolean(weapon.range),
//           melee: weapon.damage.includes("DB"), // if a weapon doesDamageBonus usually means it's a melee weapon
//           addb: weapon.damage.includes("DB"),
//         },
//         range: {
//           // TODO
//         },
//       },
//     };
//     let newSkill = null;
//     if (existingWeapon) {
//       const skill = actor.getOwnedItem(existingWeapon.data.data.skill.main.id);
//       if (!skill) {
//         const foundSkill = list.skills.find(
//           (i) => i.data.name === existingWeapon.data.data.skill.main.name
//         );
//         newSkill = duplicate(foundSkill);
//         newSkill.data.value = weapon.value;
//         const experience = weapon.value - Number(foundSkill.data.data.base);
//         if (experience !== 0) {
//           newSkill.data.adjustments = { experience };
//         }
//       }
//     }
//   });
// };

const addItems = (actor, data) => {
  const items = data.possessions.map((item) => {
    return {
      name: item.name,
      type: "item",
      quantity: item.count,
      data: {
        description: item.detail ? `<p>${item.detail}</p>` : "",
      },
    };
  });
  return actor.addItems(items);
};