class AdfParserService {

    extractText(node) {

        if (!node) {
            return "";
        }

        if (Array.isArray(node)) {

            return node
                .map(item =>
                    this.extractText(item)
                )
                .join(" ");
        }

        if (
            node.type === "text"
        ) {
            return node.text;
        }

        if (node.content) {

            return node.content
                .map(item =>
                    this.extractText(item)
                )
                .join(" ");
        }

        return "";
    }
}

module.exports =
    AdfParserService;