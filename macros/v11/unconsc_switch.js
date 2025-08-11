const target = actor || canvas.tokens.controlled[0].actor || game.user.character;

if (target !== null) {
    let unco = target.system.conditions.unconscious.value;
    let text = "";

    if (!!unco == false) {
        unco = true;
        text = "気絶した。";
    } else {
        unco = false;
        text = "目を覚ました。";
    }

    target.toggleCondition("unconscious")

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