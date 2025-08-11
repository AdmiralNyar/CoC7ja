const target = actor || canvas.tokens.controlled[0].actor || game.user.character;

if (target !== null) {
    let cw = target.system.conditions.criticalWounds.value;
    let text = "";

    if (!!cw == false) {
        cw = true;
        text = "になった。";
    } else {
        cw = false;
        text = "から回復した。";
    }

    target.toggleCondition("criticalWounds")

    const content = `<p>${target.name}は重症状態${text}</p>`;

    let chatData = {
        user: game.user._id,
        speaker: ChatMessage.getSpeaker(),
        content: content
    };

    ChatMessage.create(chatData, {});
} else {
    ui.notifications.warn("トークンを選択してください");
}