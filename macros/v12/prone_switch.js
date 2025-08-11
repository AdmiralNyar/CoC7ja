const target = actor || canvas.tokens.controlled[0].actor || game.user.character;

if (target !== null) {
    let indef = target.system.conditions.prone.value;
    let text = "";

    if (!!indef == false) {
        indef = true;
        text = "伏せ状態となった。";
    } else {
        indef = false;
        text = "起き上がった。";
    }

    target.toggleCondition("prone")

    const content = `<p>${target.name}は${text}</p>`;

    let chatData = {
        user: game.user._id,
        speaker: ChatMessage.getSpeaker(),
        content: content
    };

    ChatMessage.create(chatData, {});
} else {
    ui.notifications.warn("トークンを選択してください");
}