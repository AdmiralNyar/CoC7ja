const target = actor || canvas.tokens.controlled[0].actor || game.user.character;

if (target !== null) {
    let indef = target.system.conditions.indefInsane.value;
    let text = "";

    if (!!indef == false) {
        indef = true;
        text = "になった。";
    } else {
        indef = false;
        text = "が治った。";
    }

    target.toggleCondition("indefInsane")

    const content = `<p>${target.name}は狂気${text}</p>`;

    let chatData = {
        user: game.user._id,
        speaker: ChatMessage.getSpeaker(),
        content: content
    };

    ChatMessage.create(chatData, {});
} else {
    ui.notifications.warn("トークンを選択してください");
}