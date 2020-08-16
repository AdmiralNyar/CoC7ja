
let removedPacks = ["CoC7.skills","CoC7.weapons", "CoC7.examples"];

Hooks.on("renderCompendiumDirectory",   function(app, html, other) {
	console.log("Clean Ready")
    html.find('[data-pack]').each(function(li) {
      const pack = game.packs.find(pack => pack.collection === this.dataset.pack);
      if (pack && removedPacks.includes(pack.collection)) {
        $(this).remove();
      }
    });
  });
