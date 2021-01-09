import env from "dotenv";
import axios from "axios";
import dayjs from "dayjs";
import colors from "colors";
import mongoose from "mongoose";
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { DiscordAPIError, WebhookClient } from "discord.js";

env.config()
dayjs.extend(utc)
dayjs.extend(timezone)

/* = = = = = DISCORD SETUP = = = = = */

const Discord = require("discord.js");
const client = new Discord.Client();
client.login(process.env.TOKEN)

let testHook = new Discord.WebhookClient(process.env.testHookID, process.env.testHookToken) /* My Test Server */ 

/* = = = = = Mongoose SETUP = = = = = */

mongoose.connect(`mongodb://${process.env.MongoUser}:${process.env.MongoPass}@localhost:27017/${process.env.MongoDB}?authSource=PJSDB`, {
    useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true,
}, (err: Error) => {
    if (err) console.log(err);
})

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const MedalTVSchema = new Schema({
    author: ObjectId,
    streamer: String,
    video: String,
    date: Number
});

const MedalTVModel = mongoose.model("MedalTV", MedalTVSchema);

/* = = = = = MedalTV SETUP = = = = = */

const streamers = new Map();
streamers.set("Saabpar", {
    id: 3659873,
    servers: [testHook]
})
streamers.set("EmperorSR", {
    id: 6240449,
    servers: [testHook]
})

/* = = = = = Function Types = = = = = */

type videoObject = {
    contentId: string,
    contentTitle: string,
    contentThumbnail: string,
    videoLengthSeconds: Number,
    createdTimestamp: Date,
    directClipUrl: string,
    credits: string,
}

type dbObject = { 
    streamer: String | undefined, 
    video: String | undefined
}



/* = = = = = Database Functions = = = = = */

const fetchLastVideoByUser = function (userid: string, servers: Array<WebhookClient>): void {
        
    let url = `https://developers.medal.tv/v1/latest?userId=${userid}`;
    let options = { headers: {"Authorization" : "x"} };

    axios.get(url, options).then(async(res) => {
        console.log(colors.green("AXIOS"), colors.yellow(userid));
        let content = res.data.contentObjects;
        
        if (content.length) {
            let data = content//.shift();
            findVideoDB(userid, data, servers)

        } else console.log(`User ${userid} has no clips set to public!`)
    })
}

// See if a user exists in the db, if its a new user, add record into db. Else return current record.
const findVideoDB = (userid: String, video: any, servers: Array<WebhookClient>): void => {
    MedalTVModel.findOne({"streamer": `${userid}`}, (err, res: any) => {
        if (err) throw err;
        if (res) {
            console.log(res.video, video.contentId);
            
            if (video.length == res.length || video.contentId == res[0].video || video.createdTimestamp < res[0].date) return console.log(colors.red("SAME ID or OLD DATE"))
            else return updateRecord(userid, video[0], servers, "update")
        }
        else updateRecord(userid, video, servers, res ? "update" : "insert");
        
    })
}

// Add or update a clip to the db, userid and video reference ids.
const updateRecord = (userid: String, data: videoObject, servers: Array<WebhookClient>, dbType: String) => {
    console.log(colors.yellow(`[${userid}] ${dbType} Records . . .`));

    if (dbType == "insert") {
        console.log(colors.red(`INSERTING RECORD`));
        
        let { contentId, createdTimestamp } = data;
        new MedalTVModel({ 
            streamer: userid,
            video: contentId,
            date: createdTimestamp
        }).save((err, res) => { if (err) return console.error(err) })
    }
    else if (dbType == "update") {
        console.log(colors.red(`UPDATING RECORD`));

        MedalTVModel.update({streamer: userid}, {video: data.contentId}, (res:any): void => {
            console.log(colors.green("update RES: "), res);
        })
    }

    console.log(colors.yellow(`[${userid}] Generating Embeds . . .`));
    generateEmbed(userid, data, servers);

}

// send the new clip to all servers if a newer clip is found.
const generateEmbed = (userid: String, input: videoObject, servers: Array<WebhookClient>) => {
        
    let { contentId, contentTitle, contentThumbnail, videoLengthSeconds, createdTimestamp, directClipUrl, credits} = input;
    let embed = new Discord.MessageEmbed();
    
    embed.setDescription(`[Duration: ${videoLengthSeconds}s] [[Video](${directClipUrl})] [[Profile](https://medal.tv/users/${userid})] [${contentId}]
        Created: ${dayjs(createdTimestamp).tz("America/Los_Angeles").format('MM/DD/YYYY hh:mm:ssa') } PST`)

    embed.setTitle(contentTitle)
    embed.setThumbnail(contentThumbnail)
    embed.setURL(directClipUrl)
    embed.setFooter(`${credits}`)

    console.log(colors.yellow(`[${userid}] Sending Embeds . . .`));
    servers.every((hook: WebhookClient) => hook.send(`${directClipUrl}`/*, {embeds: [embed]}*/))
} 

/* = = = = = Driver  = = = = = */

client.on("ready", async () => {

    console.log(`[MedalTV] ${client.user.tag} is now online!`);
    
    let updater: any = setInterval(function() {
        console.log(colors.red("Running update . . ."));
        
        streamers.forEach((data) => {
            
            let {id, servers} = data;
            console.log(colors.yellow(`[${id}] Updating . . .`));
            fetchLastVideoByUser(id, servers)
        })

    }, 1e4 /* 60 Seconds */) 

    process.on("SIGINT", () => {
        clearInterval(updater)
        process.exit()
    })

})
