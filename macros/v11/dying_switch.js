const target = actor || canvas.tokens.controlled[0].actor || game.user.character;

if (target !== null) {
    let dying = target.system.conditions.dying.value;
    let text = "";

    if (!!dying == false) {
        dying = true;
        text = "になった。";
    } else {
        dying = false;
        text = "から回復した。";
    }

    target.toggleCondition("dying")

    const content = `<p>${target.name}は瀕死状態${text}</p>`;

    let chatData = {
        user: game.user._id,
        speaker: ChatMessage.getSpeaker(),
        content: content
    };

    ChatMessage.create(chatData, {});
} else {
    ui.notifications.warn("トークンを選択してください");
}