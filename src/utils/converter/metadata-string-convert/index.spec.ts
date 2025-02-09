import { metadataToString } from "./index";

describe("metadataToString", () => {
    it("should return undefined when input is undefined", () => {
        expect(metadataToString(undefined)).toBeUndefined();
    });

    it("should return the same string when input is a string", () => {
        const input = "test string";
        expect(metadataToString(input)).toBe(input);
    });

    it("should join array of strings", () => {
        const input = ["this is ", "a test ", "string"];
        expect(metadataToString(input)).toBe("this is a test string");
    });

    it("should handle empty array", () => {
        expect(metadataToString([])).toBe("");
    });

    it("should handle array with empty strings", () => {
        expect(metadataToString(["", "", ""])).toBe("");
    });

    it("should handle array with single string", () => {
        expect(metadataToString(["single"])).toBe("single");
    });
});
