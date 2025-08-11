const tableName = "キャスティング・ロールのプッシュ失敗表（弱い）";

const promises = game.packs.contents
    .filter((pack) => pack.documentName === "RollTable")
    .map((pack) => pack.getDocuments());
Promise.all(promises).then((contents) => {
    const tables = game.tables.contents.concat(contents.flat());
    const table = tables.find((t) => t.name === tableName);

    const roll = table.draw();

    const chatData = {
        user: game.user._id,
        speaker: ChatMessage.getSpeaker(),
        content: `<p style="text-align:center;"> ${table.name} </p><hr>` + `${roll.results[0].text}`,
    };
    ChatMessage.create(chatData, {});
});